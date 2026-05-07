/**
 * Student Auth Middleware
 * Handles session validation for the student portal.
 */
module.exports = {
    // Ensure student is logged in
    isStudentAuthenticated: (req, res, next) => {
        if (req.session && req.session.student) {
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
