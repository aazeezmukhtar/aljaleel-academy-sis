const db = require('../utils/db');

const settingsMiddleware = async (req, res, next) => {
    try {
        const rows = await db.all('SELECT key, value FROM settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        
        // Inject into res.locals for ejs access
        res.locals.school = settings;
        next();
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.locals.school = {
            school_name: 'Nexus SIS',
            primary_color: '#2c3e50'
        };
        next();
    }
};

module.exports = settingsMiddleware;
