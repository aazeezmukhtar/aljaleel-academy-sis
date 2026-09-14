const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');

const settingsMiddleware = async (req, res, next) => {
    // Derive authoritative schoolId from verified session (staff or student) or request context
    const sessionSchoolId = (req.session && req.session.staff && req.session.staff.school_id)
        || (req.session && req.session.student && req.session.student.school_id);
    const schoolId = sessionSchoolId ? Number(sessionSchoolId) : (req.schoolId || (req.school ? req.school.id : null));

    try {
        const settings = {};
        if (schoolId) {
            const rows = await db.all(
                'SELECT key, value FROM settings WHERE school_id = ?',
                [schoolId]
            );
            rows.forEach(row => {
                settings[row.key] = row.value;
            });

            // Overlay core school record defaults if not explicitly configured in settings table
            if (req.school && Number(req.school.id) === Number(schoolId)) {
                if (req.school.name && !settings.school_name) settings.school_name = req.school.name;
                if (req.school.motto && !settings.school_motto) settings.school_motto = req.school.motto;
                if (req.school.logo_url && !settings.school_logo) settings.school_logo = req.school.logo_url;
                if (req.school.primary_color && !settings.primary_color) settings.primary_color = req.school.primary_color;
                if (req.school.secondary_color && !settings.secondary_color) settings.secondary_color = req.school.secondary_color;
                if (req.school.address && !settings.address) settings.address = req.school.address;
                if (req.school.phone && !settings.phone) settings.phone = req.school.phone;
                if (req.school.current_session && !settings.current_session) settings.current_session = req.school.current_session;
                if (req.school.current_term && !settings.current_term) settings.current_term = req.school.current_term;
            }
        }
        
        res.locals.school = settings;
        res.locals.current_session = settings.current_session || (req.school ? req.school.current_session : null);
        res.locals.current_term = settings.current_term || (req.school ? req.school.current_term : null);
        res.locals.available_sessions = schoolId ? await sessionHelper.getAvailableSessions(schoolId) : [];
        res.locals.available_terms = sessionHelper.getAvailableTerms();
        next();
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.locals.school = {};
        res.locals.current_session = null;
        res.locals.current_term = null;
        res.locals.available_sessions = [];
        res.locals.available_terms = sessionHelper.getAvailableTerms();
        next();
    }
};

module.exports = settingsMiddleware;


