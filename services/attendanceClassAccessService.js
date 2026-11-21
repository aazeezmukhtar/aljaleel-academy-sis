'use strict';

const createAttendanceClassAccessService = ({ db, sessionHelper }) => {
    if (!db || !sessionHelper) throw new Error('Attendance class access requires db and sessionHelper.');

    const getAssignedClasses = async (user, schoolId) => {
        if (!user || !schoolId) return [];
        if (user.role === 'Admin') {
            return db.all(`
                SELECT c.*, s.name AS section_name
                FROM classes c
                LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
                WHERE c.school_id = ?
                ORDER BY s.name ASC, c.name ASC
            `, [schoolId]);
        }

        const staffId = Number(user.id);
        if (!Number.isSafeInteger(staffId) || staffId <= 0) return [];

        // A section's own calendar takes precedence because Academy and Tahfeez
        // may be in different sessions. The tenant setting is only a fallback
        // for sections without a configured current_session.
        const configuredSession = await sessionHelper.getCurrentSession(schoolId);
        return db.all(`
            SELECT c.*, s.name AS section_name
            FROM classes c
            LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
            WHERE c.school_id = ?
              AND (
                c.form_teacher_id = ?
                OR EXISTS (
                    SELECT 1
                    FROM class_assignments ca
                    WHERE ca.class_id = c.id
                      AND ca.staff_id = ?
                      AND ca.session = COALESCE(NULLIF(s.current_session, ''), ?)
                )
              )
            ORDER BY s.name ASC, c.name ASC
        `, [schoolId, staffId, staffId, configuredSession || '']);
    };

    const hasClassAttendanceAuthority = async (user, classId, schoolId) => {
        if (!user || !classId || !schoolId) return false;
        const classes = await getAssignedClasses(user, schoolId);
        return classes.some(item => Number(item.id) === Number(classId));
    };

    return { getAssignedClasses, hasClassAttendanceAuthority };
};

module.exports = { createAttendanceClassAccessService };
