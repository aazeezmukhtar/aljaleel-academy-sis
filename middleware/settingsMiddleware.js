const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const settingsMiddleware = (req, res, next) => {
    try {
        const rows = db.prepare('SELECT key, value FROM settings').all();
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
