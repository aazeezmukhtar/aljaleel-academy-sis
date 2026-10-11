/**
 * Auth Middleware
 * Handles session validation, tenant verification, and role-based access control.
 */
module.exports = {
    // Ensure user is logged in and tenant matches
    isAuthenticated: (req, res, next) => {
        if (req.session && req.session.staff) {
            // Fail closed if authenticated staff session lacks school_id
            if (!req.session.staff.school_id) {
                return res.status(403).send('Access Denied: Missing Tenant Context');
            }
            // Tenant authorization check
            if (req.schoolId && Number(req.session.staff.school_id) !== Number(req.schoolId)) {
                return res.status(403).send('Access Denied: Tenant Context Mismatch');
            }
            req.schoolId = Number(req.session.staff.school_id);
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
            if (req.schoolId && req.session.staff.school_id && Number(req.session.staff.school_id) !== Number(req.schoolId)) {
                return res.status(403).send('Access Denied: Tenant Context Mismatch');
            }
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

    // Allow either staff or student with matching tenant
    isAnyAuthenticated: (req, res, next) => {
        const staff = req.session && req.session.staff;
        const student = req.session && req.session.student;

        if (staff || student) {
            const userSchoolId = staff ? staff.school_id : student.school_id;
            if (req.schoolId && userSchoolId && Number(userSchoolId) !== Number(req.schoolId)) {
                if (req.originalUrl.startsWith('/api/')) {
                    return res.status(403).json({ error: 'Tenant Context Mismatch' });
                }
                return res.status(403).send('Access Denied: Tenant Context Mismatch');
            }
            return next();
        }
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        res.redirect('/auth/login');
    }
};

