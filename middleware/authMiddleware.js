/**
 * Auth Middleware
 * Handles session validation and role-based access control.
 */
module.exports = {
    isAuthenticated: (req, res, next) => {
        if (req.session && req.session.staff) {
            res.locals.user = req.session.staff; // Inject user into templates
            return next();
        }
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.method !== 'GET') {
            return res.status(401).json({ success: false, message: 'Session expired' });
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
    },

    // Allow either staff or student
    isAnyAuthenticated: (req, res, next) => {
        if ((req.session && req.session.staff) || (req.session && req.session.student)) {
            return next();
        }
        // Redirect logic depends on the route, but if API we should ideally return 401.
        // But for web, we will redirect to /auth/login as a fallback.
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        res.redirect('/auth/login');
    }
};
