const db = require('./db');

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY BOOTSTRAP FALLBACK
// Used ONLY when a school record genuinely has no session configuration at all
// (e.g. a brand-new school record that has never been configured).
// This value must NEVER be used to satisfy requests from a different tenant.
// ─────────────────────────────────────────────────────────────────────────────
const BOOTSTRAP_SESSION_FALLBACK = '2025/2026';
const BOOTSTRAP_TERM_FALLBACK = '1st Term';

/**
 * Get all available academic sessions for a specific tenant school.
 * Sources (all strictly scoped to schoolId):
 *   1. results → students.school_id = schoolId
 *   2. student_enrollments → students.school_id = schoolId
 *   3. sections.school_id = schoolId
 *   4. schools.current_session WHERE id = schoolId
 *   5. settings.current_session WHERE school_id = schoolId
 *
 * The tenant's current session is ALWAYS included even if no historical records exist.
 *
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<string[]>} Sorted array of session strings (newest first)
 */
async function getAvailableSessions(schoolId) {
    if (!schoolId) {
        console.warn('[sessionHelper] getAvailableSessions called without schoolId — returning empty');
        return [];
    }

    try {
        const sessions = new Set();

        // 1. Sessions from results (via student tenant ownership)
        const resultSessions = await db.all(`
            SELECT DISTINCT r.session
            FROM results r
            JOIN students s ON r.student_id = s.id
            WHERE s.school_id = ? AND r.session IS NOT NULL
            ORDER BY r.session DESC
        `, [schoolId]);
        resultSessions.forEach(r => sessions.add(r.session));

        // 2. Sessions from student_enrollments (via student tenant ownership)
        const enrollmentSessions = await db.all(`
            SELECT DISTINCT se.session
            FROM student_enrollments se
            JOIN students s ON se.student_id = s.id
            WHERE s.school_id = ? AND se.session IS NOT NULL
        `, [schoolId]);
        enrollmentSessions.forEach(e => sessions.add(e.session));

        // 3. Sessions from sections belonging to this school
        const sectionSessions = await db.all(`
            SELECT DISTINCT current_session
            FROM sections
            WHERE school_id = ? AND current_session IS NOT NULL
        `, [schoolId]);
        sectionSessions.forEach(s => sessions.add(s.current_session));

        // 4. Authoritative current session from schools table
        const schoolRow = await db.get('SELECT current_session FROM schools WHERE id = ?', [schoolId]);
        if (schoolRow && schoolRow.current_session) {
            sessions.add(schoolRow.current_session);
        }

        // 5. Current session from scoped settings
        const settingRow = await db.get(
            "SELECT value FROM settings WHERE key = 'current_session' AND school_id = ?",
            [schoolId]
        );
        if (settingRow && settingRow.value) {
            sessions.add(settingRow.value);
        }

        const sessionArray = Array.from(sessions);
        sessionArray.sort((a, b) => {
            const aYear = parseInt(a.split('/')[0]) || 0;
            const bYear = parseInt(b.split('/')[0]) || 0;
            return bYear - aYear;
        });

        return sessionArray.length > 0 ? sessionArray : [BOOTSTRAP_SESSION_FALLBACK];
    } catch (err) {
        console.error('[sessionHelper] Error fetching available sessions for school', schoolId, err);
        return [BOOTSTRAP_SESSION_FALLBACK];
    }
}

/**
 * Get the current academic session for a specific tenant school.
 * Resolution hierarchy:
 *   a. settings.current_session WHERE school_id = schoolId
 *   b. schools.current_session WHERE id = schoolId
 *   c. Bootstrap fallback (documented, isolated)
 *
 * Never falls back to another school's setting.
 *
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<string>} Current session string
 */
async function getCurrentSession(schoolId) {
    if (!schoolId) {
        console.warn('[sessionHelper] getCurrentSession called without schoolId');
        return BOOTSTRAP_SESSION_FALLBACK;
    }

    try {
        // Authority 1: scoped settings
        const settingRow = await db.get(
            "SELECT value FROM settings WHERE key = 'current_session' AND school_id = ?",
            [schoolId]
        );
        if (settingRow && settingRow.value) return settingRow.value;

        // Authority 2: schools table
        const schoolRow = await db.get('SELECT current_session FROM schools WHERE id = ?', [schoolId]);
        if (schoolRow && schoolRow.current_session) return schoolRow.current_session;

        // Bootstrap fallback — school has no config yet
        console.warn('[sessionHelper] No session config found for school', schoolId, '— using bootstrap fallback');
        return BOOTSTRAP_SESSION_FALLBACK;
    } catch (err) {
        console.error('[sessionHelper] Error fetching current session for school', schoolId, err);
        return BOOTSTRAP_SESSION_FALLBACK;
    }
}

/**
 * Get the current academic term for a specific tenant school.
 * Resolution hierarchy:
 *   a. settings.current_term WHERE school_id = schoolId
 *   b. schools.current_term WHERE id = schoolId
 *   c. Bootstrap fallback
 *
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<string>} Current term string
 */
async function getCurrentTerm(schoolId) {
    if (!schoolId) {
        console.warn('[sessionHelper] getCurrentTerm called without schoolId');
        return BOOTSTRAP_TERM_FALLBACK;
    }

    try {
        // Authority 1: scoped settings
        const settingRow = await db.get(
            "SELECT value FROM settings WHERE key = 'current_term' AND school_id = ?",
            [schoolId]
        );
        if (settingRow && settingRow.value) return settingRow.value;

        // Authority 2: schools table
        const schoolRow = await db.get('SELECT current_term FROM schools WHERE id = ?', [schoolId]);
        if (schoolRow && schoolRow.current_term) return schoolRow.current_term;

        // Bootstrap fallback
        console.warn('[sessionHelper] No term config found for school', schoolId, '— using bootstrap fallback');
        return BOOTSTRAP_TERM_FALLBACK;
    } catch (err) {
        console.error('[sessionHelper] Error fetching current term for school', schoolId, err);
        return BOOTSTRAP_TERM_FALLBACK;
    }
}

/**
 * Get all available terms (fixed 3 terms — these are global constants, not tenant-specific)
 * @returns {string[]}
 */
function getAvailableTerms() {
    return ['1st Term', '2nd Term', '3rd Term'];
}

/**
 * Get academic context (session and term) for a specific class, scoped to a tenant.
 * Resolution hierarchy:
 *   a. section-level context (class → section.current_session/term) if section belongs to school
 *   b. tenant settings
 *   c. schools table
 *   d. bootstrap fallback
 *
 * @param {number} classId - Class ID
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<{session: string, term: string}>}
 */
async function getAcademicContext(classId, schoolId) {
    if (!schoolId) {
        console.warn('[sessionHelper] getAcademicContext called without schoolId');
    }

    try {
        if (classId && schoolId) {
            // Verify class belongs to this school and get its section context
            const section = await db.get(`
                SELECT s.current_session, s.current_term
                FROM sections s
                JOIN classes c ON c.section_id = s.id
                WHERE c.id = ? AND c.school_id = ? AND s.school_id = ?
            `, [classId, schoolId, schoolId]);

            if (section && section.current_session && section.current_term) {
                return { session: section.current_session, term: section.current_term };
            }
        }

        // Fall back to tenant-level
        const session = await getCurrentSession(schoolId);
        const term = await getCurrentTerm(schoolId);
        return { session, term };
    } catch (err) {
        console.error('[sessionHelper] Error fetching academic context for class', classId, err);
        return { session: BOOTSTRAP_SESSION_FALLBACK, term: BOOTSTRAP_TERM_FALLBACK };
    }
}

/**
 * Get section-specific academic context, scoped to a tenant.
 * @param {number} sectionId - Section ID
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<{session: string, term: string}>}
 */
async function getSectionContext(sectionId, schoolId) {
    if (!schoolId) {
        console.warn('[sessionHelper] getSectionContext called without schoolId');
    }

    try {
        if (sectionId && schoolId) {
            const section = await db.get(
                'SELECT current_session, current_term FROM sections WHERE id = ? AND school_id = ?',
                [sectionId, schoolId]
            );
            if (section && section.current_session && section.current_term) {
                return { session: section.current_session, term: section.current_term };
            }
        }

        // Fall back to tenant-level
        const session = await getCurrentSession(schoolId);
        const term = await getCurrentTerm(schoolId);
        return { session, term };
    } catch (err) {
        console.error('[sessionHelper] Error fetching section context for section', sectionId, err);
    }
}

module.exports = {
    getAvailableSessions,
    getCurrentSession,
    getCurrentTerm,
    getAvailableTerms,
    getAcademicContext,
    getSectionContext,
    // Export constants so callers can identify bootstrap fallback values if needed
    BOOTSTRAP_SESSION_FALLBACK,
    BOOTSTRAP_TERM_FALLBACK
};

