'use strict';

const db = require('./db');

/**
 * Attendance-only student list.
 *
 * Prefer authoritative enrollment history for the requested session. For
 * legacy/inconsistent records, include a student whose current_class_id points
 * to this class only when they have no enrollment record at all for that
 * session. This avoids hiding legacy students without overriding a conflicting
 * current-session enrollment in another class.
 */
async function getAttendanceStudents(classId, session, schoolId, date) {
    const classIdNum = Number(classId);
    const schoolIdNum = Number(schoolId);

    if (session) {
        return db.all(`
            SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number,
                   s.passport_photo_path, a.status
            FROM students s
            LEFT JOIN attendance a
              ON s.id = a.student_id AND a.date = ? AND a.class_id = ?
            WHERE s.school_id = ?
              AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
              AND (
                EXISTS (
                    SELECT 1
                    FROM student_enrollments se
                    WHERE se.student_id = s.id
                      AND se.class_id = ?
                      AND se.session = ?
                )
                OR (
                    s.current_class_id = ?
                    AND NOT EXISTS (
                        SELECT 1
                        FROM student_enrollments se_current
                        WHERE se_current.student_id = s.id
                          AND se_current.session = ?
                    )
                )
              )
            ORDER BY s.last_name, s.first_name
        `, [date, classIdNum, schoolIdNum, classIdNum, session, classIdNum, session]);
    }

    // If no academic session is available, retain the existing class-membership
    // behavior without applying a session-specific exclusion.
    return db.all(`
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number,
               s.passport_photo_path, a.status
        FROM students s
        LEFT JOIN attendance a
          ON s.id = a.student_id AND a.date = ? AND a.class_id = ?
        WHERE s.school_id = ?
          AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
          AND (
            EXISTS (
                SELECT 1
                FROM student_enrollments se
                WHERE se.student_id = s.id AND se.class_id = ?
            )
            OR s.current_class_id = ?
          )
        ORDER BY s.last_name, s.first_name
    `, [date, classIdNum, schoolIdNum, classIdNum, classIdNum]);
}

module.exports = { getAttendanceStudents };
