'use strict';

const crypto = require('crypto');
const attendanceRegisterReminders = require('../services/attendanceRegisterReminderService');

function readCronToken(req) {
    const authorization = String(req.headers.authorization || '');
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    return bearer ? bearer[1].trim() : String(req.headers['x-cron-secret'] || '').trim();
}

function safeSecretMatch(expected, supplied) {
    if (!expected || !supplied) return false;
    const expectedBytes = Buffer.from(expected, 'utf8');
    const suppliedBytes = Buffer.from(supplied, 'utf8');
    if (expectedBytes.length !== suppliedBytes.length) return false;
    return crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

exports.runAttendanceReminderScheduler = async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return res.status(503).json({
            success: false,
            message: 'Attendance reminder scheduling is not configured.'
        });
    }
    if (!safeSecretMatch(secret, readCronToken(req))) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }

    try {
        const result = await attendanceRegisterReminders.runScheduler({ limit: 100 });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('[attendance-reminder-scheduler] Run failed:', error);
        return res.status(500).json({
            success: false,
            message: 'Attendance reminder scheduling failed.'
        });
    }
};

module.exports._test = { readCronToken, safeSecretMatch };
