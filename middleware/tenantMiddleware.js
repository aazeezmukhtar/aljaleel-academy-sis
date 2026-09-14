/**
 * middleware/tenantMiddleware.js
 * 
 * ACADME SIS ΓÇö CENTRALIZED SERVER-SIDE TENANT RESOLUTION & CONSISTENCY
 * 
 * Establishes trusted tenant identity (`req.school` and `req.schoolId`) on every request
 * and enforces strict session-to-tenant consistency.
 * 
 * Rules:
 * 1. Resolves from verified server-side session:
 *    - Staff: req.session.staff.school_id
 *    - Student: req.session.student.school_id
 * 2. Fallback:
 *    - Public / Unauthenticated routes or single-school phase -> getDefaultTenant()
 * 3. ABSOLUTE SECURITY:
 *    - NEVER accepts or trusts req.body.school_id, req.query.school_id, or req.params.school_id
 *      as authoritative tenant identity.
 * 4. SESSION CONSISTENCY:
 *    - If session.school_id exists, it MUST match the resolved tenant.
 *    - Mismatches trigger immediate session destruction and safe redirection without leaking tenant metadata.
 */

const tenantHelper = require('../utils/tenantHelper');

const tenantMiddleware = async (req, res, next) => {
    try {
        let tenant = null;
        let sessionSchoolId = null;

        // 1. Check authenticated staff session
        if (req.session && req.session.staff && req.session.staff.school_id) {
            sessionSchoolId = Number(req.session.staff.school_id);
            tenant = await tenantHelper.getTenantById(sessionSchoolId);
        }

        // 2. Check authenticated student session
        if (!tenant && req.session && req.session.student && req.session.student.school_id) {
            sessionSchoolId = Number(req.session.student.school_id);
            tenant = await tenantHelper.getTenantById(sessionSchoolId);
        }

        // 3. Fallback to default active tenant (backward compatibility & public pages)
        if (!tenant) {
            tenant = await tenantHelper.getDefaultTenant();
        }

        // 4. Safe structural fallback if database is empty/unseeded
        if (!tenant) {
            tenant = {
                id: 1,
                name: 'AcadMe SIS',
                slug: 'default',
                status: 'active',
                primary_color: '#1e3a8a',
                secondary_color: '#fbba00',
                current_session: '2025/2026',
                current_term: '1st Term'
            };
        }

        // 5. Session/Tenant Consistency Validation
        if (sessionSchoolId !== null && tenant && Number(tenant.id) !== sessionSchoolId) {
            console.warn(`[SECURITY ALERT] Tenant mismatch detected for session: session.school_id=${sessionSchoolId}, resolved.id=${tenant.id}. Invalidating session.`);
            
            return req.session.destroy(() => {
                if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.method !== 'GET') {
                    return res.status(401).json({ success: false, message: 'Invalid session context' });
                }
                res.redirect('/auth/login?error=Session context changed. Please log in again.');
            });
        }

        // Attach authoritative server-side tenant context to request
        req.school = tenant;
        req.schoolId = Number(tenant.id);

        // Expose to view templates
        res.locals.currentSchool = tenant;

        next();
    } catch (err) {
        console.error('[TenantMiddleware] Error resolving tenant context:', err.message);
        req.school = {
            id: 1,
            name: 'AcadMe SIS',
            slug: 'default',
            status: 'active'
        };
        req.schoolId = 1;
        res.locals.currentSchool = req.school;
        next();
    }
};

module.exports = tenantMiddleware;

