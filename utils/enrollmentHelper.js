const db = require('./db');

/**
 * Get students enrolled in a class for a given session.
 * Uses student_enrollments junction table with fallback to current_class_id.
 */
async function getEnrolledStudents(classId, session = null) {
    const classIdNum = Number(classId);

    // Build query for enrollment table
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
    }

    return students;
}

module.exports = { getEnrolledStudents };
