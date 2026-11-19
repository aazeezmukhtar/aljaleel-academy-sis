'use strict';

const db = require('./db');

async function getAttendanceRoster(classId, session, schoolId, date, term = null) {
    const classIdNum = Number(classId);
    const schoolIdNum = Number(schoolId);
    const clazz = await db.get(
        'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
        [classIdNum, schoolIdNum]
    );
    if (!clazz || !clazz.section_id) {
        return { students: [], unknownEnrollmentCount: 0 };
    }

    if (session && date) {
        // Dated, confirmed placement is authoritative for a register date.
        // Current enrollment rows are consulted only to flag legacy members
        // whose dates are unknown; they never make a student eligible.
        const students = await db.all(`
            SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number,
                   s.passport_photo_path, a.status
            FROM students s
            JOIN student_enrollment_periods ep
              ON ep.student_id = s.id AND ep.school_id = s.school_id
            LEFT JOIN attendance a
              ON a.student_id = s.id AND a.class_id = ? AND a.section_id = ?
             AND a.date = ? AND a.session = ? AND (? IS NULL OR a.term = ?)
            WHERE s.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
              AND ep.session = ? AND ep.date_status = 'confirmed'
              AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
              AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
            ORDER BY s.last_name, s.first_name
        `, [classIdNum, Number(clazz.section_id), date, session, term, term,
             schoolIdNum, Number(clazz.section_id), classIdNum, session, date, date]);

        const unresolved = await db.get(`
            SELECT COUNT(DISTINCT s.id) AS count
            FROM students s
            WHERE s.school_id = ?
              AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
              AND (
                EXISTS (
                    SELECT 1 FROM student_enrollments se
                    WHERE se.student_id = s.id AND se.class_id = ? AND se.session = ?
                )
                OR (
                    s.current_class_id = ?
                    AND NOT EXISTS (
                        SELECT 1 FROM student_enrollments se_current
                        WHERE se_current.student_id = s.id AND se_current.session = ?
                    )
                )
              )
              AND (
                NOT EXISTS (
                    SELECT 1 FROM student_enrollment_periods ep
                    WHERE ep.school_id = s.school_id AND ep.student_id = s.id
                      AND ep.section_id = ? AND ep.class_id = ? AND ep.session = ?
                )
                OR EXISTS (
                    SELECT 1 FROM student_enrollment_periods ep
                    WHERE ep.school_id = s.school_id AND ep.student_id = s.id
                      AND ep.section_id = ? AND ep.class_id = ? AND ep.session = ?
                      AND ep.date_status = 'review_needed'
                      AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
                )
              )
        `, [schoolIdNum, classIdNum, session, classIdNum, session,
             Number(clazz.section_id), classIdNum, session,
             Number(clazz.section_id), classIdNum, session, date, date]);

        return { students, unknownEnrollmentCount: Number(unresolved && unresolved.count || 0) };
    }

    // Legacy read-only fallback when academic context is unavailable. Saving
    // and submission still require session/date context and dated placements.
    const students = await db.all(`
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number,
               s.passport_photo_path, a.status
        FROM students s
        LEFT JOIN attendance a
          ON a.student_id = s.id AND a.class_id = ? AND a.section_id = ?
         AND a.date = ? AND (? IS NULL OR a.term = ?)
        WHERE s.school_id = ?
          AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
          AND (EXISTS (
                SELECT 1 FROM student_enrollments se
                WHERE se.student_id = s.id AND se.class_id = ?
              ) OR s.current_class_id = ?)
        ORDER BY s.last_name, s.first_name
    `, [classIdNum, Number(clazz.section_id), date, term, term,
         schoolIdNum, classIdNum, classIdNum]);
    return { students, unknownEnrollmentCount: students.length };
}

async function getAttendanceStudents(classId, session, schoolId, date, term = null) {
    const roster = await getAttendanceRoster(classId, session, schoolId, date, term);
    return roster.students;
}

module.exports = { getAttendanceStudents, getAttendanceRoster };
