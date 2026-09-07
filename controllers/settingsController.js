const db = require('../utils/db');

// Get Settings Page
const getSettingsPage = async (req, res) => {
    try {
        const settingsArr = await db.all('SELECT * FROM settings');
        const settings = {};
        settingsArr.forEach(s => settings[s.key] = s.value);

        const sections = await db.all('SELECT * FROM sections ORDER BY name');
        const sessionRows = await db.all('SELECT * FROM sessions ORDER BY name DESC').catch(() => []);
        
        let available_sessions = sessionRows.map(s => s.name);
        ['2024/2025', '2025/2026', '2026/2027'].forEach(s => {
            if (!available_sessions.includes(s)) available_sessions.push(s);
        });

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

    if (logoFile) {
        const logoPath = '/uploads/' + logoFile.filename;
        updates.push({ key: 'school_logo', value: logoPath });
    }

    try {
        await db.transaction(async () => {
            for (const item of updates) {
                if (item.value !== undefined && item.value !== null && item.value !== '') { // Only update if value is provided
                    await db.run(`
                        INSERT INTO settings (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    `, [item.key, String(item.value)]);
                }
            }
        });

        res.redirect('/settings?success=Settings updated successfully');
    } catch (err) {
        console.error('Update Settings Error:', err);
        res.redirect('/settings?error=Failed to update settings');
    }
};

// GET /settings/promotion
const getPromotionPage = async (req, res) => {
    try {
        const sections = await db.all('SELECT * FROM sections ORDER BY name');
        const classes = await db.all(`
            SELECT c.*, s.name as section_name, s.current_session as sec_session
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            ORDER BY s.name, c.name
        `);

        // Fetch distinct available sessions across enrollments, sections, and settings
        const sessionRows = await db.all(`
            SELECT DISTINCT session FROM student_enrollments WHERE session IS NOT NULL
            UNION
            SELECT DISTINCT current_session as session FROM sections WHERE current_session IS NOT NULL
        `).catch(() => []);
        
        let available_sessions = sessionRows.map(s => s.session).filter(Boolean);
        ['2024/2025', '2025/2026', '2026/2027', '2027/2028'].forEach(s => {
            if (!available_sessions.includes(s)) available_sessions.push(s);
        });
        available_sessions.sort((a, b) => {
            const aY = parseInt(a.split('/')[0]) || 0;
            const bY = parseInt(b.split('/')[0]) || 0;
            return bY - aY;
        });

        // Determine default source and target sessions
        const currentSettingRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSessionDefault = currentSettingRow ? currentSettingRow.value : (available_sessions[0] || '2026/2027');
        
        // Selected source session (from query parameter or default to pre-current session)
        const selectedSourceSession = req.query.source_session || (
            available_sessions.includes('2025/2026') ? '2025/2026' : available_sessions[1] || available_sessions[0]
        );
        
        // Calculate default target session from source session
        const srcParts = selectedSourceSession.split('/');
        const defaultTargetSession = srcParts.length === 2 
            ? `${parseInt(srcParts[0]) + 1}/${parseInt(srcParts[1]) + 1}` 
            : currentSessionDefault;

        // Count active students in each class for the selected source session
        // Uses student_enrollments for the chosen source_session, with fallback to current_class_id
        for (let c of classes) {
            let count = await db.get(`
                SELECT COUNT(DISTINCT se.student_id) as total 
                FROM student_enrollments se
                JOIN students s ON se.student_id = s.id
                WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
            `, [c.id, selectedSourceSession]);
            
            let total = count ? (count.total || 0) : 0;
            
            // If total is 0, check if students are assigned via current_class_id (fallback for legacy or initial cohorts)
            if (total === 0) {
                const currentCount = await db.get(`
                    SELECT COUNT(*) as total
                    FROM students
                    WHERE current_class_id = ? AND status = 'active'
                `, [c.id]);
                if (currentCount && currentCount.total > 0) {
                    total = currentCount.total;
                }
            }

            c.studentCount = total;
        }
        
        res.render('settings/promotion', {
            title: 'Session Transition & Promotion',
            sections,
            classes,
            available_sessions,
            sourceSession: selectedSourceSession,
            targetSession: defaultTargetSession,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Promotion Page Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /settings/promotion/preview - Dry-run endpoint
const previewPromotion = async (req, res) => {
    const { source_session, target_session, mapping } = req.body;

    if (!source_session || !target_session) {
        return res.status(400).json({ success: false, message: 'Source and target sessions are required.' });
    }

    try {
        const classes = await db.all(`
            SELECT c.id, c.name, c.section_id, s.name as section_name
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
        `);
        const classMap = new Map();
        classes.forEach(c => classMap.set(c.id, c));

        const previewData = [];
        let totalStudentsCount = 0;

        for (const [classIdStr, targetId] of Object.entries(mapping || {})) {
            const classId = parseInt(classIdStr);
            if (!targetId || targetId === 'none') continue;

            const sourceClass = classMap.get(classId);
            if (!sourceClass) continue;

            let targetClassName = 'No Change';
            let isGraduate = false;

            if (targetId === 'graduate') {
                targetClassName = '🎓 Graduating / Alumni';
                isGraduate = true;
            } else {
                const targetClass = classMap.get(parseInt(targetId));
                if (!targetClass) continue;

                // Strict section affinity validation
                if (sourceClass.section_id !== targetClass.section_id) {
                    return res.status(400).json({
                        success: false,
                        message: `Cross-section error: Class "${sourceClass.name}" (${sourceClass.section_name}) cannot be promoted to "${targetClass.name}" (${targetClass.section_name}). Both classes must be in the same section.`
                    });
                }
                targetClassName = targetClass.name;
            }

            // Fetch students enrolled in source class for source_session (with fallback to current_class_id)
            let enrolledStudents = await db.all(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number, s.status, s.current_class_id
                FROM students s
                JOIN student_enrollments se ON s.id = se.student_id
                WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                ORDER BY s.last_name, s.first_name
            `, [classId, source_session]);

            if (enrolledStudents.length === 0) {
                enrolledStudents = await db.all(`
                    SELECT s.id, s.first_name, s.last_name, s.admission_number, s.status, s.current_class_id
                    FROM students s
                    WHERE s.current_class_id = ? AND s.status = 'active'
                    ORDER BY s.last_name, s.first_name
                `, [classId]);
            }

            totalStudentsCount += enrolledStudents.length;

            previewData.push({
                sourceClassId: classId,
                sourceClassName: sourceClass.name,
                sectionName: sourceClass.section_name,
                targetClassId: targetId,
                targetClassName,
                isGraduate,
                studentCount: enrolledStudents.length,
                students: enrolledStudents.map(st => ({
                    id: st.id,
                    name: `${st.first_name} ${st.last_name}`,
                    admissionNumber: st.admission_number,
                    currentClassId: st.current_class_id
                }))
            });
        }

        res.json({
            success: true,
            sourceSession: source_session,
            targetSession: target_session,
            totalClasses: previewData.length,
            totalStudents: totalStudentsCount,
            preview: previewData
        });
    } catch (err) {
        console.error('Preview Promotion Error:', err);
        res.status(500).json({ success: false, message: 'Failed to calculate promotion preview: ' + err.message });
    }
};

// POST /settings/promotion - Atomic, section-safe execution
const processPromotion = async (req, res) => {
    const { source_session, target_session, mapping } = req.body;
    
    if (!source_session || !target_session) {
        return res.redirect(`/settings/promotion?error=${encodeURIComponent('Source and target sessions are required.')}`);
    }

    if (source_session === target_session) {
        return res.redirect(`/settings/promotion?error=${encodeURIComponent('Source session and destination session cannot be identical.')}`);
    }

    try {
        const classes = await db.all(`
            SELECT c.id, c.name, c.section_id, s.name as section_name
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
        `);
        const classMap = new Map();
        classes.forEach(c => classMap.set(c.id, c));

        let totalPromoted = 0;
        let totalGraduated = 0;

        await db.transaction(async () => {
            for (const [classIdStr, targetIdStr] of Object.entries(mapping || {})) {
                const classId = parseInt(classIdStr);
                if (!targetIdStr || targetIdStr === 'none') continue;

                const sourceClass = classMap.get(classId);
                if (!sourceClass) continue;

                const sourceSectionId = sourceClass.section_id;

                if (targetIdStr === 'graduate') {
                    // Find active students in source class for source_session (with fallback to current_class_id)
                    let enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                    `, [classId, source_session]);

                    if (enrolledStudents.length === 0) {
                        enrolledStudents = await db.all(`
                            SELECT s.id FROM students s
                            WHERE s.current_class_id = ? AND s.status = 'active'
                        `, [classId]);
                    }

                    if (enrolledStudents.length > 0) {
                        const ids = enrolledStudents.map(s => s.id);
                        for (const studentId of ids) {
                            await db.run("UPDATE students SET status = 'graduated' WHERE id = ?", [studentId]);
                        }
                        totalGraduated += ids.length;
                    }
                } else {
                    const targetId = parseInt(targetIdStr);
                    const targetClass = classMap.get(targetId);
                    if (!targetClass) {
                        throw new Error(`Invalid destination class ID: ${targetIdStr}`);
                    }

                    // Strict section affinity: source and target MUST share the exact same section_id
                    if (sourceSectionId !== targetClass.section_id) {
                        throw new Error(`Section mismatch: Cannot promote from "${sourceClass.name}" (${sourceClass.section_name}) to "${targetClass.name}" (${targetClass.section_name}). Both classes must be in the same section.`);
                    }

                    // Query students enrolled in this specific source class for source_session (with fallback to current_class_id)
                    let enrolledStudents = await db.all(`
                        SELECT s.id, s.current_class_id
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                    `, [classId, source_session]);

                    if (enrolledStudents.length === 0) {
                        enrolledStudents = await db.all(`
                            SELECT s.id, s.current_class_id FROM students s
                            WHERE s.current_class_id = ? AND s.status = 'active'
                        `, [classId]);
                    }

                    for (const student of enrolledStudents) {
                        // 1. Clear ANY existing enrollment for the student in target_session ONLY for the section being promoted!
                        // This strictly protects dual enrollments in other sections (e.g. Tahfeez stays untouched when Academy is promoted).
                        if (sourceSectionId) {
                            await db.run(`
                                DELETE FROM student_enrollments 
                                WHERE student_id = ? 
                                  AND class_id IN (SELECT id FROM classes WHERE section_id = ?) 
                                  AND session = ?
                            `, [student.id, sourceSectionId, target_session]);
                        }

                        // 2. Enroll student in target class for the target_session
                        await db.run(`
                            INSERT INTO student_enrollments (student_id, class_id, session)
                            VALUES (?, ?, ?)
                        `, [student.id, targetId, target_session]);

                        // 3. Update students.current_class_id with section affinity awareness:
                        // Only update current_class_id if:
                        //   a) The student's current_class_id belongs to the section being promoted, OR
                        //   b) The student's current_class_id is NULL or not assigned.
                        // If the student's current_class_id belongs to a DIFFERENT section (e.g. Tahfeez),
                        // we leave current_class_id alone so we do NOT overwrite their other section assignment!
                        const currentClassObj = classMap.get(student.current_class_id);
                        if (!currentClassObj || currentClassObj.section_id === sourceSectionId) {
                            await db.run('UPDATE students SET current_class_id = ? WHERE id = ?', [targetId, student.id]);
                        }

                        totalPromoted++;
                    }
                }
            }

            // Log the promotion action into audit_logs if user is authenticated
            if (req.session && req.session.staff) {
                const { logAction } = require('../utils/logger');
                logAction(
                    req.session.staff.id,
                    'PROMOTION_EXECUTED',
                    'SETTINGS',
                    {
                        source_session,
                        target_session,
                        totalPromoted,
                        totalGraduated
                    },
                    req.ip || '127.0.0.1'
                );
            }
        });
        
        res.redirect(`/settings/promotion?success=${encodeURIComponent(`Promotion completed successfully! ${totalPromoted} student enrollment(s) updated, ${totalGraduated} graduated into session ${target_session}.`)}&source_session=${encodeURIComponent(source_session)}`);
    } catch (err) {
        console.error('Process Promotion Error:', err);
        res.redirect(`/settings/promotion?error=${encodeURIComponent(err.message)}&source_session=${encodeURIComponent(source_session || '')}`);
    }
};

// POST /settings/section-calendar - Update per-section session & term
const updateSectionCalendar = async (req, res) => {
    try {
        const sections = await db.all('SELECT id FROM sections');
        await db.transaction(async () => {
            for (const sec of sections) {
                const session = req.body[`sections_${sec.id}_session`];
                const term = req.body[`sections_${sec.id}_term`];
                if (session && term) {
                    await db.run(
                        'UPDATE sections SET current_session = ?, current_term = ? WHERE id = ?',
                        [session, term, sec.id]
                    );
                }
            }
        });
        res.redirect('/settings?success=Section calendars updated successfully');
    } catch (err) {
        console.error('Update Section Calendar Error:', err);
        res.redirect('/settings?error=Failed to update section calendars');
    }
};

module.exports = { 
    getSettingsPage, 
    updateSettings, 
    updateSectionCalendar, 
    getPromotionPage, 
    previewPromotion, 
    processPromotion 
};

