/**
 * Auth Middleware
 * Handles session validation and role-based access control.
 */
module.exports = {
    // Ensure user is logged in
    isAuthenticated: (req, res, next) => {
        if (req.session && req.session.staff) {
            res.locals.user = req.session.staff; // Inject user into templates
            return next();
        }
        res.redirect('/auth/login');
    },

    // Ensure user is an Admin
    isAdmin: (req, res, next) => {
        if (req.session && req.session.staff && req.session.staff.role === 'Admin') {
            return next();
        }
        res.status(403).send('Access Denied: Admin Privileges Required');
    },

    // Inject user info into all responses (if logged in)
    injectUser: (req, res, next) => {
        if (req.session && req.session.staff) {
            res.locals.user = req.session.staff;
        } else {
            res.locals.user = null;
        }
        next();
    }
};
