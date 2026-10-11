const db = require('../utils/db');

/**
 * Student Auth Middleware
 * Handles session validation and tenant consistency for the student portal.
 */
module.exports = {
    // Ensure student is logged in
    isStudentAuthenticated: async (req, res, next) => {
        if (req.session && req.session.student) {
            req.schoolId = Number(req.session.student.school_id || 1);
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

