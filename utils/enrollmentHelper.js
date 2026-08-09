const db = require('./db');

/**
 * Get students enrolled in a class for a given session.
 * Uses student_enrollments junction table with fallback to current_class_id.
 */
async function getEnrolledStudents(classId, session = null) {
    const classIdNum = Number(classId);

    let enrollmentQuery = `
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number, 
               s.passport_photo_path, s.gender, s.status
        FROM students s
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_id = ?
    `;
    const params = [classIdNum];
    if (session) {
        enrollmentQuery += " AND se.session = ?";
        params.push(session);
    }
    enrollmentQuery += " AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)";
    enrollmentQuery += " ORDER BY s.last_name, s.first_name";

    let students = await db.all(enrollmentQuery, params);

    // Fallback to current_class_id if no enrollment records found
    if (students.length === 0) {
        let fallbackQuery = `
            SELECT id, first_name, last_name, admission_number, 
                   passport_photo_path, gender, status
            FROM students
            WHERE current_class_id = ?
              AND (status = 'active' OR status = 'Active' OR status IS NULL)
            ORDER BY last_name, first_name
        `;
        students = await db.all(fallbackQuery, [classIdNum]);
    }

    return students;
}

/**
 * Get the section for a given class.
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
 */
async function getSectionResultConfig(sectionId) {
    if (sectionId) {
        const cfg = await db.get('SELECT * FROM section_result_config WHERE section_id = ?', [sectionId]);
        if (cfg) return cfg;
    }

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

