const db = require('../utils/db');
<<<<<<< HEAD
=======
const sessionHelper = require('../utils/sessionHelper');
>>>>>>> local-master

const settingsMiddleware = async (req, res, next) => {
    try {
        const rows = await db.all('SELECT key, value FROM settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        
<<<<<<< HEAD
        res.locals.school = settings;
=======
        // Inject into res.locals for ejs access
        res.locals.school = settings;
        res.locals.available_sessions = await sessionHelper.getAvailableSessions();
        res.locals.available_terms = sessionHelper.getAvailableTerms();
>>>>>>> local-master
        next();
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.locals.school = {
<<<<<<< HEAD
            school_name: 'Al-Jaleel Academy',
            primary_color: '#2c3e50'
        };
=======
            school_name: 'Nexus SIS',
            primary_color: '#2c3e50'
        };
        res.locals.available_sessions = ['2024/2025'];
        res.locals.available_terms = ['1st Term', '2nd Term', '3rd Term'];
>>>>>>> local-master
        next();
    }
};

module.exports = settingsMiddleware;
