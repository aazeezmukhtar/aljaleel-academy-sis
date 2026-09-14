const db = require('../utils/db');
const tenantHelper = require('../utils/tenantHelper');
const sessionHelper = require('../utils/sessionHelper');

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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
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
            try {
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
                if (logoFile) { schoolFields.push('logo_url = ?'); schoolParams.push('/uploads/' + logoFile.filename); }

                if (schoolFields.length > 0) {
                    schoolParams.push(schoolId);
                    await db.run(`UPDATE schools SET ${schoolFields.join(', ')} WHERE id = ?`, schoolParams);
                }
            } catch (sErr) {
                // Non-fatal if schools table does not have matching columns yet
            }
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const classes = await db.all(`
            SELECT c.*, s.name as section_name, s.current_session as sec_session
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            WHERE c.school_id = ?
            ORDER BY s.name, c.name
        `, [schoolId]);
        
        // Count students in each class based on its section's current session
        for (let c of classes) {
            const classSession = c.sec_session || '2025/2026';
            const count = await db.get(`
                SELECT COUNT(DISTINCT se.student_id) as total 
                FROM student_enrollments se
                JOIN students s ON se.student_id = s.id
                WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                  AND s.school_id = ?
            `, [c.id, classSession, schoolId]);
            c.studentCount = count ? count.total : 0;
            c.currentSession = classSession;
        }
        
        res.render('settings/promotion', {
            title: 'Session Transition & Promotion',
            classes,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Promotion Page Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /settings/promotion
const processPromotion = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { mapping } = req.body;
    
    try {
        const classes = await db.all(`
            SELECT c.id, c.section_id, s.current_session
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            WHERE c.school_id = ?
        `, [schoolId]);
        
        const classSessionMap = {};
        const classSectionIdMap = {};
        classes.forEach(c => {
            classSessionMap[c.id] = c.current_session || '2025/2026';
            classSectionIdMap[c.id] = c.section_id;
        });

        await db.transaction(async () => {
            for (const [classIdStr, targetId] of Object.entries(mapping || {})) {
                const classId = parseInt(classIdStr);
                const currentSession = classSessionMap[classId];
                if (!currentSession) continue;

                const parts = currentSession.split('/');
                const nextSession = parts.length === 2 ? `${parseInt(parts[0]) + 1}/${parseInt(parts[1]) + 1}` : '2026/2027';

                if (targetId === 'graduate') {
                    const enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                          AND s.school_id = ?
                    `, [classId, currentSession, schoolId]);

                    if (enrolledStudents.length > 0) {
                        const ids = enrolledStudents.map(s => s.id);
                        const placeholders = ids.map(() => '?').join(',');
                        await db.run(`UPDATE students SET status = 'graduated' WHERE id IN (${placeholders}) AND school_id = ?`, [...ids, schoolId]);
                    }
                } else if (targetId && targetId !== 'none') {
                    const enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                          AND s.school_id = ?
                    `, [classId, currentSession, schoolId]);

                    const targetSectionId = classSectionIdMap[targetId];

                    for (const student of enrolledStudents) {
                        await db.run('UPDATE students SET current_class_id = ? WHERE id = ? AND school_id = ?', [targetId, student.id, schoolId]);
                        
                        if (targetSectionId) {
                            await db.run(`
                                DELETE FROM student_enrollments 
                                WHERE student_id = ? 
                                  AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?) 
                                  AND session = ?
                            `, [student.id, targetSectionId, schoolId, nextSession]);
                        }

                        await db.run(`
                            INSERT INTO student_enrollments (student_id, class_id, session)
                            VALUES (?, ?, ?)
                        `, [student.id, targetId, nextSession]);
                    }
                }
            }
        });
        
        res.redirect('/settings/promotion?success=Promotion completed successfully');
    } catch (err) {
        console.error('Process Promotion Error:', err);
        res.redirect(`/settings/promotion?error=${encodeURIComponent(err.message)}`);
    }
};

// POST /settings/section-calendar - Update per-section session & term
const updateSectionCalendar = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const sections = await db.all('SELECT id FROM sections WHERE school_id = ?', [schoolId]);
        await db.transaction(async () => {
            for (const sec of sections) {
                const session = req.body[`sections_${sec.id}_session`];
                const term = req.body[`sections_${sec.id}_term`];
                if (session && term) {
                    await db.run(
                        'UPDATE sections SET current_session = ?, current_term = ? WHERE id = ? AND school_id = ?',
                        [session, term, sec.id, schoolId]
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

module.exports = { getSettingsPage, updateSettings, updateSectionCalendar, getPromotionPage, processPromotion };

