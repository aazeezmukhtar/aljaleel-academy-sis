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
        const classes = await db.all('SELECT * FROM classes ORDER BY name');
        // Count students in each class
        for (let c of classes) {
            const count = await db.get('SELECT COUNT(*) as total FROM students WHERE current_class_id = ? AND status = \'active\'', [c.id]);
            c.studentCount = count.total;
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
        await db.transaction(async () => {
            for (const [classId, targetId] of Object.entries(mapping)) {
                if (targetId === 'graduate') {
                    await db.run('UPDATE students SET status = \'graduated\' WHERE current_class_id = ? AND status = \'active\'', [classId]);
                } else if (targetId && targetId !== 'none') {
                    await db.run('UPDATE students SET current_class_id = ? WHERE current_class_id = ? AND status = \'active\'', [targetId, classId]);
                }
            }
        });
        
        res.redirect('/settings/promotion?success=Promotion completed successfully');
    } catch (err) {
        console.error('Process Promotion Error:', err);
        res.redirect('/settings/promotion?error=Promotion failed');
    }
};

// POST /settings/section-calendar - Update per-section session & term
const updateSectionCalendar = async (req, res) => {
    const { sections } = req.body; // { "1": { session: '...', term: '...' }, "2": { ... } }
    try {
        await db.transaction(async () => {
            for (const [sectionId, vals] of Object.entries(sections || {})) {
                if (vals.session && vals.term) {
                    await db.run(
                        'UPDATE sections SET current_session = ?, current_term = ? WHERE id = ?',
                        [vals.session, vals.term, sectionId]
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
