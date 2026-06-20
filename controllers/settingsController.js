const db = require('../utils/db');

// Get Settings Page
const getSettingsPage = async (req, res) => {
    try {
        const settingsArr = await db.all('SELECT * FROM settings');
        const settings = {};
        settingsArr.forEach(s => settings[s.key] = s.value);

        const sections = await db.all('SELECT * FROM sections ORDER BY name');

        res.render('settings', {
            title: 'School Settings',
            settings,
            sections,
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
        current_session, current_term
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
        { key: 'current_term', value: current_term }
    ];

    if (logoFile) {
        const logoPath = '/uploads/' + logoFile.filename;
        updates.push({ key: 'school_logo', value: logoPath });
    }

    try {
        await db.transaction(async () => {
            for (const item of updates) {
                if (item.value) { // Only update if value is provided
                    await db.run(`
                        INSERT INTO settings (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    `, [item.key, item.value]);
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
        const classes = await db.all(`
            SELECT c.*, s.name as section_name, s.current_session as sec_session
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            ORDER BY s.name, c.name
        `);
        
        // Count students in each class based on its section's current session
        for (let c of classes) {
            const classSession = c.sec_session || '2024/2025';
            const count = await db.get(`
                SELECT COUNT(DISTINCT se.student_id) as total 
                FROM student_enrollments se
                JOIN students s ON se.student_id = s.id
                WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
            `, [c.id, classSession]);
            c.studentCount = count.total;
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
    const { mapping } = req.body; // mapping will be { class_id: target_class_id or 'graduate' }
    
    try {
        // Fetch all classes and their section sessions
        const classes = await db.all(`
            SELECT c.id, c.section_id, s.current_session
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
        `);
        
        const classSessionMap = {};
        const classSectionIdMap = {};
        classes.forEach(c => {
            classSessionMap[c.id] = c.current_session || '2024/2025';
            classSectionIdMap[c.id] = c.section_id;
        });

        await db.transaction(async () => {
            for (const [classIdStr, targetId] of Object.entries(mapping || {})) {
                const classId = parseInt(classIdStr);
                const currentSession = classSessionMap[classId];
                if (!currentSession) continue;

                const parts = currentSession.split('/');
                const nextSession = parts.length === 2 ? `${parseInt(parts[0]) + 1}/${parseInt(parts[1]) + 1}` : '2025/2026';

                if (targetId === 'graduate') {
                    // Find active students enrolled in this class for the current session
                    const enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                    `, [classId, currentSession]);

                    if (enrolledStudents.length > 0) {
                        const ids = enrolledStudents.map(s => s.id);
                        const placeholders = ids.map(() => '?').join(',');
                        await db.run(`UPDATE students SET status = 'graduated' WHERE id IN (${placeholders})`, ids);
                    }
                } else if (targetId && targetId !== 'none') {
                    // Find active students enrolled in this class for the current session
                    const enrolledStudents = await db.all(`
                        SELECT s.id 
                        FROM students s
                        JOIN student_enrollments se ON s.id = se.student_id
                        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
                    `, [classId, currentSession]);

                    const targetSectionId = classSectionIdMap[targetId];

                    for (const student of enrolledStudents) {
                        // Keep legacy current_class_id updated
                        await db.run('UPDATE students SET current_class_id = ? WHERE id = ?', [targetId, student.id]);
                        
                        // Clear existing enrollments for the student in nextSession for classes belonging to the target section
                        if (targetSectionId) {
                            await db.run(`
                                DELETE FROM student_enrollments 
                                WHERE student_id = ? 
                                  AND class_id IN (SELECT id FROM classes WHERE section_id = ?) 
                                  AND session = ?
                            `, [student.id, targetSectionId, nextSession]);
                        }

                        // Enroll in the next session
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

module.exports = { getSettingsPage, updateSettings, updateSectionCalendar, getPromotionPage, processPromotion };
