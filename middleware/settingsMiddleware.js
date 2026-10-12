const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');

const settingsMiddleware = async (req, res, next) => {
    // Derive authoritative schoolId from verified session (staff or student) or request context
    const sessionSchoolId = (req.session && req.session.staff && req.session.staff.school_id)
        || (req.session && req.session.student && req.session.student.school_id);
    const schoolId = sessionSchoolId ? Number(sessionSchoolId) : (req.schoolId || (req.school ? req.school.id : 1));

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

            // If req.school is missing or needs populating, query the schools table
            let schoolRecord = req.school;
            if (!schoolRecord || Number(schoolRecord.id) !== Number(schoolId)) {
                schoolRecord = await db.get('SELECT * FROM schools WHERE id = ?', [schoolId]);
            }

            // Overlay core school record defaults if not explicitly configured in settings table
            if (schoolRecord) {
                if (schoolRecord.name && !settings.school_name) settings.school_name = schoolRecord.name;
                if (schoolRecord.motto && !settings.school_motto) settings.school_motto = schoolRecord.motto;
                if (schoolRecord.logo_url && !settings.school_logo) settings.school_logo = schoolRecord.logo_url;
                if (schoolRecord.primary_color && !settings.primary_color) settings.primary_color = schoolRecord.primary_color;
                if (schoolRecord.secondary_color && !settings.secondary_color) settings.secondary_color = schoolRecord.secondary_color;
                if (schoolRecord.address && !settings.address) settings.address = schoolRecord.address;
                if (schoolRecord.phone && !settings.phone) settings.phone = schoolRecord.phone;
                if (schoolRecord.current_session && !settings.current_session) settings.current_session = schoolRecord.current_session;
                if (schoolRecord.current_term && !settings.current_term) settings.current_term = schoolRecord.current_term;
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


