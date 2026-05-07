const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

/**
 * Logs a system action to the audit_logs table.
 * @param {number} userId - The ID of the staff member performing the action.
 * @param {string} action - The action performed (e.g., 'LOGIN', 'SAVE_RESULT').
 * @param {string} module - The system module (e.g., 'AUTH', 'ATTENDANCE').
 * @param {object} details - Additional structured details about the action.
 * @param {string} ip - The IP address of the user.
 */
const logAction = (userId, action, module, details = {}, ip = '0.0.0.0') => {
    try {
        const stmt = db.prepare(`
            INSERT INTO audit_logs (user_id, action, module, details, ip_address)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userId, action, module, JSON.stringify(details), ip);
    } catch (err) {
        console.error('Audit Logging Error:', err);
    }
};

module.exports = { logAction };
