/**
 * WhatsApp & Attendance Notification Helper
 * 
 * Provides:
 * 1. Robust normalization and validation for Nigerian phone numbers.
 * 2. Template-based attendance message construction with placeholders.
 * 3. WhatsApp wa.me link generation with full URL encoding.
 */

/**
 * Normalizes a Nigerian phone number to international format (234XXXXXXXXXX).
 * 
 * Supports input formats such as:
 * - '08062418033'
 * - '+2348062418033'
 * - '2348062418033'
 * - '080 6241 8033'
 * - '080-6241-8033'
 * 
 * @param {string|number} phone
 * @returns {string|null} Normalized phone string (e.g. '2348062418033') or null if invalid/missing
 */
function normalizeNigerianPhone(phone) {
    if (!phone) return null;

    let cleaned = String(phone).trim();
    if (!cleaned) return null;

    // Remove common non-digit characters: spaces, dashes, parentheses, dots
    cleaned = cleaned.replace(/[\s\-().]/g, '');

    // If starts with +, strip it
    if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    }

    // Check if starts with leading 0 (national format: e.g. 08062418033 -> 11 digits)
    if (/^0[789][01]\d{8}$/.test(cleaned)) {
        return '234' + cleaned.substring(1);
    }

    // Check if starts with 234 followed by valid 10 digits (e.g. 2348062418033 -> 13 digits)
    if (/^234[789][01]\d{8}$/.test(cleaned)) {
        return cleaned;
    }

    // Some inputs might have 10 digits missing the leading 0 (e.g. 8062418033)
    if (/^[789][01]\d{8}$/.test(cleaned)) {
        return '234' + cleaned;
    }

    // Invalid or unsupported format
    return null;
}

/**
 * Default notification templates supporting configurable templates in the future.
 */
const DEFAULT_ATTENDANCE_TEMPLATES = {
    LOW_ATTENDANCE: `Assalamu Alaikum,

Dear Parent/Guardian of {student_name},

We would like to bring to your attention that your ward has recorded {total_absences} days of absence during the current term.

Regular attendance is important for your ward's academic progress. We kindly ask that you help ensure regular attendance and contact the school if there is a reason affecting the student's attendance.

Thank you for your cooperation.

{school_name}`,

    CONSECUTIVE: `Assalamu Alaikum,

Dear Parent/Guardian of {student_name},

We are concerned to note that your ward has been absent from school for {consecutive_absences} consecutive days.

Kindly contact the school to inform us of the reason for the absence and to discuss the student's return to school.

Thank you for your cooperation.

{school_name}`,

    BOTH: `Assalamu Alaikum,

Dear Parent/Guardian of {student_name},

We are concerned to note that your ward has recorded {total_absences} days of absence during the current term, including {consecutive_absences} consecutive days of absence.

Regular attendance is critical for your ward's academic progress. Kindly contact the school to inform us of the reason for the absences and to discuss your ward's return and attendance plan.

Thank you for your cooperation.

{school_name}`
};

/**
 * Replaces placeholders in a template with actual context values.
 * Placeholders supported:
 * {student_name}, {class_name}, {total_absences}, {consecutive_absences},
 * {term}, {session}, {school_name}, {school_phone}
 * 
 * @param {string} template 
 * @param {object} context 
 * @returns {string} Interpolated message
 */
function interpolateTemplate(template, context = {}) {
    if (!template) return '';

    const replacements = {
        '{student_name}': context.student_name || 'Student',
        '{class_name}': context.class_name || '',
        '{total_absences}': context.total_absences !== undefined ? String(context.total_absences) : '0',
        '{consecutive_absences}': context.consecutive_absences !== undefined ? String(context.consecutive_absences) : '0',
        '{term}': context.term || '',
        '{session}': context.session || '',
        '{school_name}': context.school_name || 'School Administration',
        '{school_phone}': context.school_phone || ''
    };

    let result = template;
    for (const [placeholder, val] of Object.entries(replacements)) {
        result = result.split(placeholder).join(val);
    }
    return result;
}

/**
 * Determines flag type and generates the appropriate message text.
 * 
 * @param {object} params
 * @param {number} params.total_absences
 * @param {number} params.consecutive_absences
 * @param {number} params.term_limit
 * @param {number} params.consecutive_limit
 * @param {object} params.context - { student_name, class_name, term, session, school_name, school_phone }
 * @param {object} [params.customTemplates] - optional custom templates to override defaults
 * @returns {string} The formatted message
 */
function generateAttendanceMessage({
    total_absences = 0,
    consecutive_absences = 0,
    term_limit = 10,
    consecutive_limit = 3,
    context = {},
    customTemplates = {}
}) {
    const isTermExceeded = total_absences >= term_limit;
    const isConsecutiveExceeded = consecutive_absences >= consecutive_limit;

    const templates = { ...DEFAULT_ATTENDANCE_TEMPLATES, ...customTemplates };

    let selectedTemplate;
    if (isTermExceeded && isConsecutiveExceeded) {
        selectedTemplate = templates.BOTH;
    } else if (isConsecutiveExceeded) {
        selectedTemplate = templates.CONSECUTIVE;
    } else {
        selectedTemplate = templates.LOW_ATTENDANCE;
    }

    return interpolateTemplate(selectedTemplate, {
        ...context,
        total_absences,
        consecutive_absences
    });
}

/**
 * Builds complete WhatsApp URL and details for at-risk attendance contact.
 * 
 * @param {object} params
 * @param {string|number} params.parent_phone
 * @param {number} params.total_absences
 * @param {number} params.consecutive_absences
 * @param {number} params.term_limit
 * @param {number} params.consecutive_limit
 * @param {object} params.context
 * @param {object} [params.customTemplates]
 * @returns {object} { normalized_phone, whatsapp_url, message, is_valid, display_phone }
 */
function buildWhatsAppAttendanceAction(params) {
    const normalized_phone = normalizeNigerianPhone(params.parent_phone);
    const message = generateAttendanceMessage(params);

    if (!normalized_phone) {
        return {
            normalized_phone: null,
            whatsapp_url: null,
            message,
            is_valid: false,
            display_phone: params.parent_phone ? String(params.parent_phone).trim() : null
        };
    }

    const whatsapp_url = `https://wa.me/${normalized_phone}?text=${encodeURIComponent(message)}`;

    return {
        normalized_phone,
        whatsapp_url,
        message,
        is_valid: true,
        display_phone: params.parent_phone ? String(params.parent_phone).trim() : normalized_phone
    };
}

module.exports = {
    normalizeNigerianPhone,
    DEFAULT_ATTENDANCE_TEMPLATES,
    interpolateTemplate,
    generateAttendanceMessage,
    buildWhatsAppAttendanceAction
};