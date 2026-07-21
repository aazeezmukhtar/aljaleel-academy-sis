<<<<<<< HEAD
/**
 * Enrollment Helper
 * Central utility for querying enrolled students per class/session.
 * Falls back to students.current_class_id when no enrollment records exist.
 */
=======
>>>>>>> local-master
const db = require('./db');

/**
 * Get students enrolled in a class for a given session.
 * Uses student_enrollments junction table with fallback to current_class_id.
 */
<<<<<<< HEAD
async function getEnrolledStudents(classId, session) {
    const classIdNum = Number(classId);
    // First try the enrollment table
    let students = await db.all(`
=======
async function getEnrolledStudents(classId, session = null) {
    const classIdNum = Number(classId);

    // Build query for enrollment table
    let enrollmentQuery = `
>>>>>>> local-master
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number, 
               s.passport_photo_path, s.gender, s.status
        FROM students s
        JOIN student_enrollments se ON s.id = se.student_id
<<<<<<< HEAD
        WHERE se.class_id = ? AND se.session = ? AND (s.status = 'active' OR s.status IS NULL OR s.status = 'Active')
        ORDER BY s.last_name, s.first_name
    `, [classIdNum, session]);

    // Fallback to current_class_id if no enrollment records
    if (students.length === 0) {
        students = await db.all(`
            SELECT id, first_name, last_name, admission_number, 
                   passport_photo_path, gender, status
            FROM students
            WHERE current_class_id = ? AND (status = 'active' OR status IS NULL OR status = 'Active')
            ORDER BY last_name, first_name
        `, [classIdNum]);
=======
        WHERE se.class_id = ?
    `;
    const params = [classIdNum];
    if (session) {
        enrollmentQuery += " AND se.session = ?";
        params.push(session);
    }
    enrollmentQuery += " AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)";
    enrollmentQuery += " ORDER BY s.first_name, s.last_name";

    let students = await db.all(enrollmentQuery, params);

    // Fallback to current_class_id if no enrollment records found
    if (students.length === 0) {
        let fallbackQuery = `
            SELECT id, first_name, last_name, admission_number, 
                   passport_photo_path, gender, status
            FROM students
            WHERE current_class_id = ?
              AND (status = 'active' OR status = 'Active' OR status IS NULL)
            ORDER BY first_name, last_name
        `;
        students = await db.all(fallbackQuery, [classIdNum]);
>>>>>>> local-master
    }

    return students;
}

<<<<<<< HEAD
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
=======
module.exports = { getEnrolledStudents };
>>>>>>> local-master
