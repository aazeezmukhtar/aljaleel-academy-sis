const db = require('../utils/db');

// Get Settings Page
const getSettingsPage = async (req, res) => {
    try {
        const settingsArr = await db.all('SELECT * FROM settings');
        const settings = {};
        settingsArr.forEach(s => settings[s.key] = s.value);

        res.render('settings', {
            title: 'School Settings',
            settings,
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
    const { school_name, school_motto, primary_color, secondary_color, address, phone, next_term_start_date, show_watermark } = req.body;
    const logoFile = req.file;

    const updates = [
        { key: 'school_name', value: school_name },
        { key: 'school_motto', value: school_motto },
        { key: 'primary_color', value: primary_color },
        { key: 'secondary_color', value: secondary_color },
        { key: 'address', value: address },
        { key: 'phone', value: phone },
        { key: 'next_term_start_date', value: next_term_start_date },
        { key: 'show_watermark', value: show_watermark === 'true' ? 'true' : 'false' }
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

module.exports = { getSettingsPage, updateSettings };
