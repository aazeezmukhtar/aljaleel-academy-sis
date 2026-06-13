const db = require('./db');

/**
 * Get students enrolled in a class for a given session.
 * Uses student_enrollments junction table with fallback to current_class_id.
 */
async function getEnrolledStudents(classId, session) {
    const classIdNum = Number(classId);
    
    // First try the enrollment table
    let students = await db.all(`
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number, 
               s.passport_photo_path, s.gender, s.status
        FROM students s
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_id = ? AND se.session = ? 
          AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
        ORDER BY s.last_name, s.first_name
    `, [classIdNum, session]);

    // Fallback to current_class_id if no enrollment records for this class & session
    if (students.length === 0) {
        students = await db.all(`
            SELECT id, first_name, last_name, admission_number, 
                   passport_photo_path, gender, status
            FROM students
            WHERE current_class_id = ? 
              AND (status = 'active' OR status = 'Active' OR status IS NULL)
            ORDER BY last_name, first_name
        `, [classIdNum]);
    }

    return students;
}

module.exports = { getEnrolledStudents };
