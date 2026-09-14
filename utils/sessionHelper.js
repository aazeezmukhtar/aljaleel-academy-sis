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

        return sessionArray;
    } catch (err) {
        console.error('[sessionHelper] Error fetching available sessions for school', schoolId, err);
        return [];
    }
}

/**
 * Get the current academic session for a specific tenant school.
 * Resolution hierarchy:
 *   1. tenant settings.current_session WHERE school_id = schoolId
 *   2. schools.current_session WHERE id = schoolId
 *   3. null (explicit unconfigured state)
 *
 * Never falls back to another school's setting.
 *
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<string|null>} Current session string or null
 */
async function getCurrentSession(schoolId) {
    if (!schoolId) {
        return null;
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

        return null;
    } catch (err) {
        console.error('[sessionHelper] Error fetching current session for school', schoolId, err);
        return null;
    }
}

/**
 * Get the current academic term for a specific tenant school.
 * Resolution hierarchy:
 *   1. tenant settings.current_term WHERE school_id = schoolId
 *   2. schools.current_term WHERE id = schoolId
 *   3. null (explicit unconfigured state)
 *
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<string|null>} Current term string or null
 */
async function getCurrentTerm(schoolId) {
    if (!schoolId) {
        return null;
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

        return null;
    } catch (err) {
        console.error('[sessionHelper] Error fetching current term for school', schoolId, err);
        return null;
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
 *   1. First verify classes.id = classId AND classes.school_id = schoolId
 *   2. Section-level override, if the class is associated with a section
 *   3. Tenant settings
 *   4. Schools.current_session/current_term
 *   5. null
 *
 * Never crosses tenant boundaries.
 *
 * @param {number} classId - Class ID
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<{session: string|null, term: string|null}>}
 */
async function getAcademicContext(classId, schoolId) {
    if (!schoolId) {
        return { session: null, term: null };
    }

    try {
        if (classId) {
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
        return { session: null, term: null };
    }
}

/**
 * Get section-specific academic context, scoped to a tenant.
 * Verifies sections.id = sectionId AND sections.school_id = schoolId
 * @param {number} sectionId - Section ID
 * @param {number} schoolId - Required tenant school ID
 * @returns {Promise<{session: string|null, term: string|null}>}
 */
async function getSectionContext(sectionId, schoolId) {
    if (!schoolId) {
        return { session: null, term: null };
    }

    try {
        if (sectionId) {
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
        return { session: null, term: null };
    }
}

module.exports = {
    getAvailableSessions,
    getCurrentSession,
    getCurrentTerm,
    getAvailableTerms,
    getAcademicContext,
    getSectionContext,
    BOOTSTRAP_SESSION_FALLBACK,
    BOOTSTRAP_TERM_FALLBACK
};

