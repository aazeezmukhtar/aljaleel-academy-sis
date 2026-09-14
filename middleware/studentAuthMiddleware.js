const db = require('../utils/db');

/**
 * Student Auth Middleware
 * Handles session validation and tenant consistency for the student portal.
 */
module.exports = {
    // Ensure student is logged in and belongs to active tenant
    isStudentAuthenticated: async (req, res, next) => {
        if (req.session && req.session.student) {
            // If absent in session, retrieve using authenticated student identity
            if (!req.session.student.school_id) {
                try {
                    const student = await db.get(
                        'SELECT school_id FROM students WHERE id = ? AND status = \'active\'',
                        [req.session.student.id]
                    );
                    if (!student || !student.school_id) {
                        return res.status(403).send('Access Denied: Missing Tenant Context');
                    }
                    req.session.student.school_id = Number(student.school_id);
                } catch (err) {
                    console.error('[StudentAuth] Error resolving student school_id:', err);
                    return res.status(403).send('Access Denied: Missing Tenant Context');
                }
            }

            if (req.schoolId && req.session.student.school_id && Number(req.session.student.school_id) !== Number(req.schoolId)) {
                return res.status(403).send('Access Denied: Tenant Context Mismatch');
            }
            req.schoolId = Number(req.session.student.school_id);
            if (!res.locals) res.locals = {};
            res.locals.studentUser = req.session.student; // Inject into templates
            return next();
        }
        res.redirect('/auth/student-login');
    },

    // Inject student info globally for portal views
    injectStudent: (req, res, next) => {
        if (req.session && req.session.student) {
            res.locals.studentUser = req.session.student;
        } else {
            res.locals.studentUser = null;
        }
        next();
    }
};

