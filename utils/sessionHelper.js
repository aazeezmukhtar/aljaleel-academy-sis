const db = require('./db');

/**
 * Get all available sessions from the system
 * Sources: results table, sections table, and settings
 * @returns {Promise<Array>} Array of unique session strings sorted
 */
async function getAvailableSessions() {
    try {
        const sessions = new Set();

        // Get sessions from results table
        const resultSessions = await db.all('SELECT DISTINCT session FROM results WHERE session IS NOT NULL ORDER BY session DESC');
        resultSessions.forEach(r => sessions.add(r.session));

        // Get sessions from sections table
        const sectionSessions = await db.all('SELECT DISTINCT current_session FROM sections WHERE current_session IS NOT NULL');
        sectionSessions.forEach(s => sessions.add(s.current_session));

        // Get current session from settings
        const currentSession = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        if (currentSession && currentSession.value) {
            sessions.add(currentSession.value);
        }

        // Convert Set to sorted Array
        const sessionArray = Array.from(sessions);
        
        // Sort sessions in descending order (newest first)
        sessionArray.sort((a, b) => {
            // Extract years if in format "YYYY/YYYY"
            const aYear = parseInt(a.split('/')[0]) || 0;
            const bYear = parseInt(b.split('/')[0]) || 0;
            return bYear - aYear;
        });

        return sessionArray.length > 0 ? sessionArray : ['2024/2025'];
    } catch (err) {
        console.error('Error fetching available sessions:', err);
        return ['2024/2025'];
    }
}

/**
 * Get the current session from settings
 * @returns {Promise<String>} Current session string
 */
async function getCurrentSession() {
    try {
        const result = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        return result && result.value ? result.value : '2024/2025';
    } catch (err) {
        console.error('Error fetching current session:', err);
        return '2024/2025';
    }
}

/**
 * Get the current term from settings
 * @returns {Promise<String>} Current term string (1st Term, 2nd Term, or 3rd Term)
 */
async function getCurrentTerm() {
    try {
        const result = await db.get("SELECT value FROM settings WHERE key = 'current_term'");
        return result && result.value ? result.value : '1st Term';
    } catch (err) {
        console.error('Error fetching current term:', err);
        return '1st Term';
    }
}

/**
 * Get all available terms (fixed 3 terms)
 * @returns {Array} Array of term strings
 */
function getAvailableTerms() {
    return ['1st Term', '2nd Term', '3rd Term'];
}

/**
 * Get academic context (session and term) for a specific class/section
 * Falls back to global settings if section doesn't have override
 * @param {Number} classId - Class ID to get context for
 * @returns {Promise<Object>} { session, term }
 */
async function getAcademicContext(classId) {
    try {
        if (classId) {
            const section = await db.get(`
                SELECT s.current_session, s.current_term
                FROM sections s
                JOIN classes c ON c.section_id = s.id
                WHERE c.id = ?
            `, [classId]);

            if (section && section.current_session && section.current_term) {
                return {
                    session: section.current_session,
                    term: section.current_term
                };
            }
        }

        // Fallback to global settings
        const session = await getCurrentSession();
        const term = await getCurrentTerm();
        return { session, term };
    } catch (err) {
        console.error('Error fetching academic context:', err);
        return { session: '2024/2025', term: '1st Term' };
    }
}

/**
 * Get section-specific academic context
 * @param {Number} sectionId - Section ID
 * @returns {Promise<Object>} { session, term }
 */
async function getSectionContext(sectionId) {
    try {
        const section = await db.get(
            'SELECT current_session, current_term FROM sections WHERE id = ?',
            [sectionId]
        );

        if (section && section.current_session && section.current_term) {
            return {
                session: section.current_session,
                term: section.current_term
            };
        }

        // Fallback to global
        const session = await getCurrentSession();
        const term = await getCurrentTerm();
        return { session, term };
    } catch (err) {
        console.error('Error fetching section context:', err);
        return { session: '2024/2025', term: '1st Term' };
    }
}

module.exports = {
    getAvailableSessions,
    getCurrentSession,
    getCurrentTerm,
    getAvailableTerms,
    getAcademicContext,
    getSectionContext
};
