const db = require('./db');

/**
 * Logs a system action to the audit_logs table.
 * @param {number} userId - The ID of the staff member performing the action.
 * @param {string} action - The action performed (e.g., 'LOGIN', 'SAVE_RESULT').
 * @param {string} module - The system module (e.g., 'AUTH', 'ATTENDANCE').
 * @param {object} details - Additional structured details about the action.
 * @param {string} ip - The IP address of the user.
 */
const logAction = async (userId, action, module, details = {}, ip = '0.0.0.0') => {
    try {
        await db.run(`
            INSERT INTO audit_logs (user_id, action, module, details, ip_address)
            VALUES (?, ?, ?, ?, ?)
        `, [userId, action, module, JSON.stringify(details), ip]);
    } catch (err) {
        console.error('Audit Logging Error:', err);
    }
};

module.exports = { logAction };
