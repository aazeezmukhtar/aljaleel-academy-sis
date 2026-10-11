/**
 * Auth Middleware
 * Handles session validation, tenant verification, and role-based access control.
 *
 * This is a single-tenant application (Al-Jaleel Academy).
 * school_id is resolved from the DB if absent from the session (e.g. stale sessions,
 * or staff records created before school_id was backfilled).
 */
const db = require('../utils/db');
const tenantHelper = require('../utils/tenantHelper');

module.exports = {
    // Ensure user is logged in; resolves school_id from DB if missing from session
    isAuthenticated: async (req, res, next) => {
        if (req.session && req.session.staff) {
            // If school_id is absent (stale session or pre-migration record), resolve it
            if (!req.session.staff.school_id) {
                try {
                    const staffRow = await db.get(
                        "SELECT school_id FROM staff WHERE id = ? AND status = 'active'",
                        [req.session.staff.id]
                    );
                    if (staffRow && staffRow.school_id) {
                        req.session.staff.school_id = Number(staffRow.school_id);
                    } else {
                        // Single-tenant fallback: use the primary active school
                        const defaultSchool = await tenantHelper.getDefaultTenant();
                        if (defaultSchool) {
                            req.session.staff.school_id = Number(defaultSchool.id);
                        } else {
                            return res.status(403).send('Access Denied: School not configured');
                        }
                    }
                } catch (err) {
                    console.error('[Auth] Error resolving school_id from DB:', err.message);
                    return res.status(500).send('Authentication error');
                }
            }
            // Tenant check (no-op in single-tenant, guards against cross-school access in multi-tenant)
            if (req.schoolId && Number(req.session.staff.school_id) !== Number(req.schoolId)) {
                return res.status(403).send('Access Denied: Tenant Context Mismatch');
            }
            req.schoolId = Number(req.session.staff.school_id);
            res.locals.user = req.session.staff;
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

