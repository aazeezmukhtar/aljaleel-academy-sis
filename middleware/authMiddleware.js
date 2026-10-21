/**
 * Auth Middleware
 * Handles session validation, tenant verification, and role-based access control.
 */
module.exports = {
    // Ensure user is logged in
    isAuthenticated: (req, res, next) => {
        if (req.session && req.session.staff) {
            req.schoolId = Number(req.session.staff.school_id || 1);
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
            req.schoolId = Number(req.session.staff.school_id || 1);
            return next();
        }
        res.status(403).send('Access Denied: Admin Privileges Required');
    },

    // Allow staff roles that manage school finances.
    // Teachers may retain the existing assigned-class read-only fee views,
    // but cannot configure fees, assign charges, or record payments.
    isAdminOrBursar: (req, res, next) => {
        const staff = req.session && req.session.staff;
        if (staff && (staff.role === 'Admin' || staff.role === 'Bursar')) {
            req.schoolId = Number(staff.school_id || 1);
            return next();
        }
        return res.status(403).send('Access Denied: Finance Privileges Required');
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
        const staff = req.session && req.session.staff;
        const student = req.session && req.session.student;

        if (staff || student) {
            req.schoolId = Number((staff ? staff.school_id : student.school_id) || 1);
            return next();
        }
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        res.redirect('/auth/login');
    }
};

