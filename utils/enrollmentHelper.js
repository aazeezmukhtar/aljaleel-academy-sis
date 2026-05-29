/**
 * Enrollment Helper
 * Central utility for querying enrolled students per class/session.
 * Falls back to students.current_class_id when no enrollment records exist.
 */
const db = require('./db');

/**
 * Get students enrolled in a class for a given session.
 * Uses student_enrollments junction table with fallback to current_class_id.
 */
async function getEnrolledStudents(classId, session) {
    // First try the enrollment table
    let students = await db.all(`
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number, 
               s.passport_photo_path, s.gender, s.status
        FROM students s
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
        ORDER BY s.last_name, s.first_name
    `, [classId, session]);

    // Fallback to current_class_id if no enrollment records
    if (students.length === 0) {
        students = await db.all(`
            SELECT id, first_name, last_name, admission_number, 
                   passport_photo_path, gender, status
            FROM students
            WHERE current_class_id = ? AND status = 'active'
            ORDER BY last_name, first_name
        `, [classId]);
    }

    return students;
}

/**
 * Get the section for a given class.
 * Returns null if no section is assigned.
 */
async function getClassSection(classId) {
    const row = await db.get(`
        SELECT s.id, s.name 
        FROM sections s 
        JOIN classes c ON c.section_id = s.id 
        WHERE c.id = ?
    `, [classId]);
    return row || null;
}

/**
 * Get the result config for a specific section.
 * Falls back to the global result_config table if no section config exists.
 */
async function getSectionResultConfig(sectionId) {
    if (sectionId) {
        const cfg = await db.get('SELECT * FROM section_result_config WHERE section_id = ?', [sectionId]);
        if (cfg) return cfg;
    }

    // Fallback: global result_config key-value table
    const rows = await db.all('SELECT * FROM result_config');
    const config = {};
    rows.forEach(r => config[r.key] = r.value);
    return {
        ca_count: parseInt(config.ca_count) || 2,
        ca1_max: parseInt(config.ca1_max) || 20,
        ca2_max: parseInt(config.ca2_max) || 20,
        exam_max: parseInt(config.exam_max) || 60
    };
}

module.exports = { getEnrolledStudents, getClassSection, getSectionResultConfig };
