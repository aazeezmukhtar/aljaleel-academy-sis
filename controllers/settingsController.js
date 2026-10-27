const db = require('../utils/db');
const tenantHelper = require('../utils/tenantHelper');
const sessionHelper = require('../utils/sessionHelper');
const { uploadFile } = require('../utils/storageHelper');

// Get Settings Page
const getSettingsPage = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    try {
        const settingsArr = await db.all(
            'SELECT * FROM settings WHERE school_id = ? ORDER BY school_id ASC',
            [schoolId]
        );
        const settings = {};
        settingsArr.forEach(s => settings[s.key] = s.value);

        const sections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY name',
            [schoolId]
        );
        const available_sessions = await sessionHelper.getAvailableSessions(schoolId);
        const available_terms = ['1st Term', '2nd Term', '3rd Term'];

        res.render('settings', {
            title: 'School Settings',
            settings,
            sections,
            available_sessions,
            available_terms,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Settings Page Error:', err);
        res.status(500).send('Database Error');
    }
};

// Update Settings
const updateSettings = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    const { 
        school_name, school_motto, primary_color, secondary_color, 
        address, phone, next_term_start_date, show_watermark,
        current_session, current_term,
        attendance_minimum_percentage,
        attendance_consecutive_absence_limit,
        attendance_term_absence_limit
    } = req.body;
    const logoFile = req.file;

    const updates = [
        { key: 'school_name', value: school_name },
        { key: 'school_motto', value: school_motto },
        { key: 'primary_color', value: primary_color },
        { key: 'secondary_color', value: secondary_color },
        { key: 'address', value: address },
        { key: 'phone', value: phone },
        { key: 'next_term_start_date', value: next_term_start_date },
        { key: 'show_watermark', value: show_watermark === 'true' ? 'true' : 'false' },
        { key: 'current_session', value: current_session },
        { key: 'current_term', value: current_term },
        { key: 'attendance.minimum_percentage', value: attendance_minimum_percentage },
        { key: 'attendance.consecutive_absence_limit', value: attendance_consecutive_absence_limit },
        { key: 'attendance.term_absence_limit', value: attendance_term_absence_limit }
    ];

    let uploadedLogoPath = null;
    if (logoFile) {
        uploadedLogoPath = await uploadFile(logoFile, 'logos');
        updates.push({ key: 'school_logo', value: uploadedLogoPath });
    }

    try {
        await db.transaction(async () => {
            for (const item of updates) {
                if (item.value !== undefined && item.value !== null && item.value !== '') {
                    // Check if setting row already exists for this school_id
                    const existing = await db.get(
                        'SELECT key FROM settings WHERE key = ? AND school_id = ?',
                        [item.key, schoolId]
                    );

                    if (existing) {
                        await db.run(
                            'UPDATE settings SET value = ?, school_id = ? WHERE key = ? AND school_id = ?',
                            [String(item.value), schoolId, item.key, schoolId]
                        );
                    } else {
                        await db.run(
                            'INSERT INTO settings (school_id, key, value) VALUES (?, ?, ?)',
                            [schoolId, item.key, String(item.value)]
                        );
                    }
                }
            }

            // Also keep the parent schools table in sync if it exists
            const schoolFields = [];
            const schoolParams = [];
            if (school_name) { schoolFields.push('name = ?'); schoolParams.push(school_name); }
            if (school_motto) { schoolFields.push('motto = ?'); schoolParams.push(school_motto); }
            if (primary_color) { schoolFields.push('primary_color = ?'); schoolParams.push(primary_color); }
            if (secondary_color) { schoolFields.push('secondary_color = ?'); schoolParams.push(secondary_color); }
            if (address) { schoolFields.push('address = ?'); schoolParams.push(address); }
            if (phone) { schoolFields.push('phone = ?'); schoolParams.push(phone); }
            if (current_session) { schoolFields.push('current_session = ?'); schoolParams.push(current_session); }
            if (current_term) { schoolFields.push('current_term = ?'); schoolParams.push(current_term); }
            if (uploadedLogoPath) { schoolFields.push('logo_url = ?'); schoolParams.push(uploadedLogoPath); }

            if (schoolFields.length > 0) {
                schoolParams.push(schoolId);
                await db.run(`UPDATE schools SET ${schoolFields.join(', ')} WHERE id = ?`, schoolParams);
            }

            // Section calendars are independently configured below. Global settings must not
            // overwrite them: getAcademicContext() intentionally prefers a section's own calendar.

        });

        // Invalidate tenant cache
        tenantHelper.clearTenantCache();

        res.redirect('/settings?success=Settings updated successfully');
    } catch (err) {
        console.error('Update Settings Error:', err);
        res.redirect('/settings?error=Failed to update settings');
    }
};

// GET /settings/promotion
const getPromotionPage = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    try {
        const sections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY id ASC',
            [schoolId]
        );

        let available_sessions = await sessionHelper.getAvailableSessions(schoolId);
        if (!available_sessions || available_sessions.length === 0) {
            available_sessions = ['2025/2026', '2026/2027'];
        }

        // Determine source session
        let sourceSession = req.query.source_session;
        if (!sourceSession) {
            const schoolSession = await sessionHelper.getCurrentSession(schoolId);
            sourceSession = schoolSession || (sections[0] ? sections[0].current_session : null) || '2025/2026';
        }

        // Determine default target session (advance source session year by 1)
        let targetSession = req.query.target_session;
        if (!targetSession) {
            const parts = sourceSession.split('/');
            targetSession = parts.length === 2 
                ? `${parseInt(parts[0], 10) + 1}/${parseInt(parts[1], 10) + 1}`
                : '2026/2027';
        }

        // Ensure source and target sessions are present in available_sessions
        const sessionSet = new Set(available_sessions);
        sessionSet.add(sourceSession);
        sessionSet.add(targetSession);

        // Also add target + 1 for dropdown options if not present
        const targetParts = targetSession.split('/');
        if (targetParts.length === 2) {
            sessionSet.add(`${parseInt(targetParts[0], 10) + 1}/${parseInt(targetParts[1], 10) + 1}`);
        }

        available_sessions = Array.from(sessionSet).sort((a, b) => {
            const aY = parseInt(a.split('/')[0], 10) || 0;
            const bY = parseInt(b.split('/')[0], 10) || 0;
            return bY - aY;
        });

        const classes = await db.all(`
            SELECT c.*, s.name as section_name, s.current_session as sec_session
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            WHERE c.school_id = ?
            ORDER BY s.name, c.name
        `, [schoolId]);
        
        // Count active students in each class based on the selected source session
        for (let c of classes) {
            const count = await db.get(`
                SELECT COUNT(DISTINCT se.student_id) as total 
                FROM student_enrollments se
                JOIN students s ON se.student_id = s.id
                WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                  AND s.school_id = ?
            `, [c.id, sourceSession, schoolId]);
            c.studentCount = count ? count.total : 0;
            c.currentSession = sourceSession;
        }
        
        res.render('settings/promotion', {
            title: 'Session Transition & Promotion',
            classes,
            sections,
            available_sessions,
            sourceSession,
            targetSession,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Promotion Page Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /settings/promotion/preview - Dry-run preview of students and target classes
const previewPromotion = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    const { source_session, target_session, mapping } = req.body;

    try {
        if (!source_session || !target_session) {
            return res.status(400).json({ success: false, message: 'Source and target sessions are required.' });
        }

        const classes = await db.all(`
            SELECT c.id, c.name, c.section_id, s.name as section_name
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            WHERE c.school_id = ?
        `, [schoolId]);

        const classMap = {};
        classes.forEach(c => { classMap[c.id] = c; });

        const preview = [];
        const warnings = [];
        let totalStudents = 0;
        let totalClasses = 0;

        for (const [classIdStr, targetId] of Object.entries(mapping || {})) {
            if (!targetId || targetId === 'none') continue;
            const classId = Number(classIdStr);
            const sourceClass = Number.isInteger(classId) ? classMap[classId] : null;
            if (!sourceClass) {
                warnings.push(`Source class "${classIdStr}" is not available. No preview was generated for this mapping.`);
                continue;
            }

            const isGraduate = targetId === 'graduate';
            const targetClassId = Number(targetId);
            const targetClass = isGraduate ? null : (Number.isInteger(targetClassId) ? classMap[targetClassId] : null);
            if (!isGraduate && !targetClass) {
                warnings.push(`Destination for "${sourceClass.name}" is not a valid class. No preview was generated for this mapping.`);
                continue;
            }
            if (!isGraduate && Number(sourceClass.section_id) !== Number(targetClass.section_id)) {
                warnings.push(`Mapping from "${sourceClass.section_name || 'General'} / ${sourceClass.name}" to "${targetClass.section_name || 'General'} / ${targetClass.name}" crosses sections and was excluded. Promotion must stay within the same section.`);
                continue;
            }

            const students = await db.all(`
                SELECT s.id, s.admission_number, s.first_name || ' ' || s.last_name as name
                FROM students s
                JOIN student_enrollments se ON s.id = se.student_id
                WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                  AND s.school_id = ?
                ORDER BY s.first_name, s.last_name
            `, [classId, source_session, schoolId]);

            totalStudents += students.length;
            totalClasses += 1;

            preview.push({
                sourceClassName: sourceClass.name,
                sectionName: sourceClass.section_name || 'General',
                targetClassName: isGraduate ? 'Graduating / Alumni' : (targetClass ? targetClass.name : 'Unknown Class'),
                isGraduate,
                studentCount: students.length,
                students: students.map(st => ({
                    id: st.id,
                    name: st.name,
                    admissionNumber: st.admission_number
                }))
            });
        }

        return res.json({
            success: true,
            totalStudents,
            totalClasses,
            preview,
            warnings
        });
    } catch (err) {
        console.error('Preview Promotion Error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// POST /settings/promotion
const processPromotion = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    const { source_session, target_session, mapping } = req.body;
    const isAjax = req.xhr || (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) || (req.headers.accept && req.headers.accept.includes('application/json'));

    try {
        const targetSession = target_session || '2026/2027';
        const sourceSession = source_session || '2025/2026';

        const classes = await db.all(`
            SELECT c.id, c.section_id
            FROM classes c
            WHERE c.school_id = ?
        `, [schoolId]);
        
        const classSectionIdMap = {};
        const validClassIds = new Set();
        classes.forEach(c => {
            classSectionIdMap[c.id] = c.section_id;
            validClassIds.add(Number(c.id));
        });

        // Validate the entire requested mapping before making any writes.
        // Invalid or foreign-school class IDs must not partially promote
        // students or advance the school's academic calendar.
        for (const [classIdStr, targetId] of Object.entries(mapping || {})) {
            if (!targetId || targetId === 'none') continue;

            const classId = Number(classIdStr);
            if (!Number.isInteger(classId) || !validClassIds.has(classId)) {
                const message = 'Promotion mapping contains an invalid source class.';
                if (isAjax) return res.status(400).json({ success: false, message });
                return res.redirect(`/settings/promotion?error=${encodeURIComponent(message)}`);
            }

            if (targetId !== 'graduate') {
                const targetClassId = Number(targetId);
                if (!/^\d+$/.test(String(targetId)) || !Number.isInteger(targetClassId) || !validClassIds.has(targetClassId)) {
                    const message = 'Promotion mapping contains an invalid target class.';
                    if (isAjax) return res.status(400).json({ success: false, message });
                    return res.redirect(`/settings/promotion?error=${encodeURIComponent(message)}`);
                }
                
                // Promotion must stay within a section. Cross-section enrollment
                // is managed through enrollment workflows, not class promotion.
                if (classSectionIdMap[classId] !== classSectionIdMap[targetClassId]) {
                    const message = 'Promotion source and target classes must belong to the same section.';
                    if (isAjax) return res.status(400).json({ success: false, message });
                    return res.redirect(`/settings/promotion?error=${encodeURIComponent(message)}`);
                }
            }
        }

        const hasActionableMapping = Object.values(mapping || {}).some(
            targetId => targetId === 'graduate' || (targetId && targetId !== 'none')
        );
        if (!hasActionableMapping) {
            const message = 'No promotion mappings were selected; the academic calendar was not changed.';
            if (isAjax) return res.json({ success: true, message, calendarAdvanced: false });
            return res.redirect(`/settings/promotion?message=${encodeURIComponent(message)}`);
        }

        await db.transaction(async () => {
            for (const [classIdStr, targetId] of Object.entries(mapping || {})) {
                const classId = parseInt(classIdStr, 10);
                if (!classId) continue;

                if (targetId === 'graduate') {
                    const enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                          AND s.school_id = ?
                    `, [classId, sourceSession, schoolId]);

                    if (enrolledStudents.length > 0) {
                        const ids = enrolledStudents.map(s => s.id);
                        const placeholders = ids.map(() => '?').join(',');
                        await db.run(
                            `UPDATE students SET status = 'graduated' WHERE id IN (${placeholders}) AND school_id = ?`,
                            [...ids, schoolId]
                        );
                    }
                } else if (targetId && targetId !== 'none') {
                    const targetClassId = parseInt(targetId, 10);
                    const enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                          AND s.school_id = ?
                    `, [classId, sourceSession, schoolId]);

                    const targetSectionId = classSectionIdMap[targetClassId];

                    for (const student of enrolledStudents) {
                        await db.run(
                            'UPDATE students SET current_class_id = ? WHERE id = ? AND school_id = ?',
                            [targetClassId, student.id, schoolId]
                        );
                        
                        // Strict section preservation: only clear existing enrollment in the SAME section for targetSession
                        if (targetSectionId) {
                            await db.run(`
                                DELETE FROM student_enrollments 
                                WHERE student_id = ? 
                                  AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?) 
                                  AND session = ?
                            `, [student.id, targetSectionId, schoolId, targetSession]);
                        } else {
                            await db.run(`
                                DELETE FROM student_enrollments 
                                WHERE student_id = ? AND class_id = ? AND session = ?
                            `, [student.id, targetClassId, targetSession]);
                        }

                        await db.run(`
                            INSERT INTO student_enrollments (student_id, class_id, session)
                            VALUES (?, ?, ?)
                        `, [student.id, targetClassId, targetSession]);
                    }
                }
            }


            // Only end-of-session promotions advance the school calendar.
            // Same-session promotions are valid for individual student movement,
            // but must leave the current session and term untouched.
            if (targetSession !== sourceSession) {
                // CRITICAL: Advance Active Academic Calendar for School & All Sections
                await db.run(
                    "UPDATE sections SET current_session = ?, current_term = '1st Term' WHERE school_id = ?",
                    [targetSession, schoolId]
                );
    
                await db.run(
                    "UPDATE schools SET current_session = ?, current_term = '1st Term' WHERE id = ?",
                    [targetSession, schoolId]
                );
    
                // Upsert current_session in settings
                const existingSession = await db.get(
                    "SELECT value FROM settings WHERE key = 'current_session' AND school_id = ?",
                    [schoolId]
                );
                if (existingSession) {
                    await db.run(
                        "UPDATE settings SET value = ? WHERE key = 'current_session' AND school_id = ?",
                        [targetSession, schoolId]
                    );
                } else {
                    await db.run(
                        "INSERT INTO settings (school_id, key, value) VALUES (?, 'current_session', ?)",
                        [schoolId, targetSession]
                    );
                }
    
                // Upsert current_term in settings
                const existingTerm = await db.get(
                    "SELECT value FROM settings WHERE key = 'current_term' AND school_id = ?",
                    [schoolId]
                );
                if (existingTerm) {
                    await db.run(
                        "UPDATE settings SET value = '1st Term' WHERE key = 'current_term' AND school_id = ?",
                        [schoolId]
                    );
                } else {
                    await db.run(
                        "INSERT INTO settings (school_id, key, value) VALUES (?, 'current_term', '1st Term')",
                        [schoolId]
                    );
                }
            }

        });

        // Invalidate tenant cache so next requests see new session

        tenantHelper.clearTenantCache();
        
        const successMessage = targetSession === sourceSession
            ? `Promotion completed successfully within ${sourceSession}. The academic calendar was not changed.`
            : `Promotion completed successfully! Active session transitioned to ${targetSession} (1st Term).`;
        if (isAjax) {
            return res.json({ success: true, message: successMessage, calendarAdvanced: targetSession !== sourceSession });
        }
        res.redirect(`/settings/promotion?success=${encodeURIComponent(successMessage)}`);
    } catch (err) {
        console.error('Process Promotion Error:', err);
        if (isAjax) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.redirect(`/settings/promotion?error=${encodeURIComponent(err.message)}`);
    }
};

// POST /settings/section-calendar - Update per-section session & term
const updateSectionCalendar = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    try {
        const sections = await db.all('SELECT id FROM sections WHERE school_id = ? ORDER BY id ASC', [schoolId]);
        const validTerms = new Set(['1st Term', '2nd Term', '3rd Term']);
        const sectionUpdates = [];
        for (const sec of sections) {
            const session = String((req.body || {})[`sections_${sec.id}_session`] || '').trim();
            const term = String((req.body || {})[`sections_${sec.id}_term`] || '').trim();
            if (!/^\d{4}\/\d{4}$/.test(session) || !validTerms.has(term)) {
                return res.redirect('/settings?error=Invalid or incomplete section calendar');
            }
            sectionUpdates.push({ id: sec.id, session, term });
        }

        await db.transaction(async () => {
            for (const sectionUpdate of sectionUpdates) {
                const { id, session, term } = sectionUpdate;
                await db.run(
                    'UPDATE sections SET current_session = ?, current_term = ? WHERE id = ? AND school_id = ?',
                    [session, term, id, schoolId]
                );
            }


        });

        // Invalidate tenant cache
        tenantHelper.clearTenantCache();

        res.redirect('/settings?success=Section calendars updated successfully');
    } catch (err) {
        console.error('Update Section Calendar Error:', err);
        res.redirect('/settings?error=Failed to update section calendars');
    }
};

module.exports = { getSettingsPage, updateSettings, updateSectionCalendar, getPromotionPage, previewPromotion, processPromotion };


