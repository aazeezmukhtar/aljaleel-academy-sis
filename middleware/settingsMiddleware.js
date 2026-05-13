const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');

const settingsMiddleware = async (req, res, next) => {
    try {
        const rows = await db.all('SELECT key, value FROM settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        
        // Inject into res.locals for ejs access
        res.locals.school = settings;
        res.locals.available_sessions = await sessionHelper.getAvailableSessions();
        res.locals.available_terms = sessionHelper.getAvailableTerms();
        next();
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.locals.school = {
            school_name: 'Nexus SIS',
            primary_color: '#2c3e50'
        };
        res.locals.available_sessions = ['2024/2025'];
        res.locals.available_terms = ['1st Term', '2nd Term', '3rd Term'];
        next();
    }
};

module.exports = settingsMiddleware;
