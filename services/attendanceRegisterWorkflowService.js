'use strict';

const VALID_STATUSES = new Set(['Present', 'Absent', 'Late', 'Leave']);
const UNMARKED_STATUS = 'Not recorded';
const FOUNDATION_TABLES = [
    'section_academic_periods',
    'class_attendance_schedules',
    'class_attendance_responsibilities',
    'class_attendance_settings',
    'class_attendance_closures',
    'attendance_registers',
    'attendance_register_students',
    'attendance_register_events',
    'attendance_register_reminders',
    'attendance_foundation_audit_logs'
];

function normalizeDate(value) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Attendance register date must use YYYY-MM-DD format.');
    }
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Attendance register date is not a valid calendar date.');
    }
    return date;
}

function createAttendanceRegisterWorkflowService(db) {
    if (!db) throw new Error('An attendance register database adapter is required.');

    async function isFoundationAvailable() {
        if (db.DB_TYPE === 'postgres') {
            const columns = FOUNDATION_TABLES.map(name =>
                "to_regclass('" + name + "') IS NOT NULL AS " + name
            ).join(', ');
            const row = await db.get('SELECT ' + columns);
            return FOUNDATION_TABLES.every(name => row[name] === true);
        }
        const rows = await db.all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (" +
            FOUNDATION_TABLES.map(() => '?').join(', ') + ')',
            FOUNDATION_TABLES
        );
        return rows.length === FOUNDATION_TABLES.length;
    }

    async function getRegisterContext(input) {
        const schoolId = Number(input && input.schoolId);
        const classId = Number(input && input.classId);
        const registerDate = normalizeDate(input && input.registerDate);
        const register = await db.get(`
            SELECT ar.*, ap.session, ap.term
            FROM attendance_registers ar
            JOIN section_academic_periods ap ON ap.id = ar.academic_period_id
            WHERE ar.school_id = ? AND ar.class_id = ? AND ar.register_date = ?
        `, [schoolId, classId, registerDate]);
        if (!register) return null;

        const students = await db.all(`
            SELECT s.id, s.first_name, s.last_name, s.admission_number,
                   s.passport_photo_path, rs.enrollment_period_id, a.status,
                   a.reason, a.reason_type, a.custom_reason
            FROM attendance_register_students rs
            JOIN attendance_registers ar ON ar.id = rs.register_id
            JOIN students s ON s.id = rs.student_id AND s.school_id = ar.school_id
            LEFT JOIN attendance a
              ON a.student_id = rs.student_id
             AND a.class_id = ar.class_id
             AND a.section_id = ar.section_id
             AND a.date = ar.register_date
             AND a.session = ?
             AND a.term = ?
            WHERE rs.register_id = ?
            ORDER BY s.last_name, s.first_name, s.id
        `, [register.session, register.term, register.id]);

        return { register, students };
    }

    async function saveRegisterProgress(input) {
        const schoolId = Number(input && input.schoolId);
        const classId = Number(input && input.classId);
        const registerDate = normalizeDate(input && input.registerDate);
        const actorStaffId = Number(input && input.actorStaffId);
        const attendance = input && input.attendance && typeof input.attendance === 'object'
            ? input.attendance : {};
        const reasons = input && input.reasons && typeof input.reasons === 'object' ? input.reasons : {};
        const customReasons = input && input.customReasons && typeof input.customReasons === 'object'
            ? input.customReasons : {};

        if (![schoolId, classId, actorStaffId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school, class and staff member are required to save register progress.');
        }

        return db.transaction(async client => {
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
            const register = await db.get(`
                SELECT ar.id, ar.section_id, ar.status, ar.expected_student_count,
                       ap.session, ap.term
                FROM attendance_registers ar
                JOIN section_academic_periods ap ON ap.id = ar.academic_period_id
                WHERE ar.school_id = ? AND ar.class_id = ? AND ar.register_date = ?
                ${lock}
            `, [schoolId, classId, registerDate], client);
            if (!register) throw new Error('No expected attendance register exists for this class and date.');
            if (register.status === 'submitted' || register.status === 'closed') {
                throw new Error('This attendance register is locked. An administrator must reopen it before changes can be saved.');
            }
            if (!['expected', 'in_progress', 'reopened'].includes(register.status)) {
                throw new Error('This attendance register is not available for editing.');
            }

            const actor = await db.get(
                'SELECT id FROM staff WHERE id = ? AND school_id = ?',
                [actorStaffId, schoolId], client
            );
            if (!actor) throw new Error('The staff member saving this register does not belong to this school.');

            const roster = await db.all(
                'SELECT student_id FROM attendance_register_students WHERE register_id = ?',
                [register.id], client
            );
            const rosterIds = new Set(roster.map(row => String(row.student_id)));
            for (const studentId of Object.keys(attendance)) {
                if (!rosterIds.has(String(Number(studentId)))) {
                    throw new Error('The submitted attendance includes a student who is not on this register roster.');
                }
            }

            let changedCount = 0;
            for (const [studentIdText, rawStatus] of Object.entries(attendance)) {
                const studentId = Number(studentIdText);
                if (!Number.isSafeInteger(studentId) || studentId <= 0) {
                    throw new Error('An invalid student ID was supplied.');
                }
                const status = String(rawStatus || '').trim();
                if (status !== UNMARKED_STATUS && !VALID_STATUSES.has(status)) {
                    throw new Error('Unsupported attendance status for student ' + studentId + '.');
                }

                const existing = await db.get(`
                    SELECT id, class_id, status, reason, reason_type, custom_reason
                    FROM attendance
                    WHERE student_id = ? AND section_id = ? AND date = ? AND session = ? AND term = ?
                `, [studentId, register.section_id, registerDate, register.session, register.term], client);
                if (existing && Number(existing.class_id) !== classId) {
                    throw new Error('An attendance record for student ' + studentId + ' already belongs to another class in this section and period.');
                }

                if (status === UNMARKED_STATUS) {
                    if (existing) {
                        await db.run('DELETE FROM attendance WHERE id = ?', [existing.id], client);
                        await db.run(`
                            INSERT INTO attendance_register_events
                                (register_id, event_type, actor_staff_id, reason, metadata)
                            VALUES (?, 'corrected', ?, 'Attendance status cleared to unmarked.', ?)
                        `, [register.id, actorStaffId, JSON.stringify({
                            student_id: studentId,
                            previous_status: existing.status,
                            new_status: null
                        })], client);
                        changedCount += 1;
                    }
                    continue;
                }

                const rawReason = reasons[studentIdText] ? String(reasons[studentIdText]) : null;
                const customReason = customReasons[studentIdText] ? String(customReasons[studentIdText]) : null;
                const reason = rawReason === 'Other' && customReason ? customReason : rawReason;

                await db.run(`
                    INSERT INTO attendance
                        (student_id, class_id, section_id, date, status, session, term,
                         reason, reason_type, custom_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(student_id, section_id, date, session, term)
                    DO UPDATE SET
                        status = excluded.status,
                        reason = excluded.reason,
                        reason_type = excluded.reason_type,
                        custom_reason = excluded.custom_reason
                `, [
                    studentId, classId, register.section_id, registerDate, status,
                    register.session, register.term, reason, rawReason, customReason
                ], client);

                if (!existing || existing.status !== status ||
                    existing.reason !== reason || existing.reason_type !== rawReason ||
                    existing.custom_reason !== customReason) {
                    changedCount += 1;
                    if (existing) {
                        await db.run(`
                            INSERT INTO attendance_register_events
                                (register_id, event_type, actor_staff_id, reason, metadata)
                            VALUES (?, 'corrected', ?, 'Attendance status or reason corrected.', ?)
                        `, [register.id, actorStaffId, JSON.stringify({
                            student_id: studentId,
                            previous_status: existing.status,
                            new_status: status
                        })], client);
                    }
                }
            }

            const saved = await db.get(`
                SELECT COUNT(*) AS count
                FROM attendance_register_students rs
                JOIN attendance a
                  ON a.student_id = rs.student_id
                 AND a.class_id = ?
                 AND a.section_id = ?
                 AND a.date = ?
                 AND a.session = ?
                 AND a.term = ?
                 AND a.status IN ('Present', 'Absent', 'Late', 'Leave')
                WHERE rs.register_id = ?
            `, [classId, register.section_id, registerDate, register.session, register.term, register.id], client);
            const savedCount = Number(saved.count);
            let nextStatus = register.status;
            if (savedCount > 0 && ['expected', 'reopened'].includes(register.status)) {
                nextStatus = 'in_progress';
                await db.run(`
                    UPDATE attendance_registers
                    SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [register.id], client);
                await db.run(`
                    INSERT INTO attendance_register_events
                        (register_id, event_type, actor_staff_id, previous_status, new_status, metadata)
                    VALUES (?, 'attendance_started', ?, ?, 'in_progress', ?)
                `, [register.id, actorStaffId, register.status, JSON.stringify({
                    saved_student_count: savedCount,
                    changed_student_count: changedCount
                })], client);
            } else if (savedCount === 0 && changedCount > 0 && register.status === 'in_progress') {
                nextStatus = 'expected';
                await db.run(`
                    UPDATE attendance_registers
                    SET status = 'expected', updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [register.id], client);
                await db.run(`
                    INSERT INTO attendance_register_events
                        (register_id, event_type, actor_staff_id, previous_status, new_status, metadata)
                    VALUES (?, 'corrected', ?, 'in_progress', 'expected', ?)
                `, [register.id, actorStaffId, JSON.stringify({
                    saved_student_count: 0,
                    changed_student_count: changedCount
                })], client);
            } else {
                await db.run('UPDATE attendance_registers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [register.id], client);
            }

            return {
                registerId: register.id,
                status: nextStatus,
                expectedStudentCount: Number(register.expected_student_count),
                savedStudentCount: savedCount,
                changedStudentCount: changedCount
            };
        });
    }

    async function submitRegister(input) {
        const schoolId = Number(input && input.schoolId);
        const classId = Number(input && input.classId);
        const registerDate = normalizeDate(input && input.registerDate);
        const actorStaffId = Number(input && input.actorStaffId);

        if (![schoolId, classId, actorStaffId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school, class and staff member are required to submit this register.');
        }

        return db.transaction(async client => {
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
            const register = await db.get(`
                SELECT ar.id, ar.section_id, ar.status, ar.expected_student_count,
                       ar.submitted_student_count, ar.first_submitted_at,
                       ap.session, ap.term
                FROM attendance_registers ar
                JOIN section_academic_periods ap ON ap.id = ar.academic_period_id
                WHERE ar.school_id = ? AND ar.class_id = ? AND ar.register_date = ?
                ${lock}
            `, [schoolId, classId, registerDate], client);
            if (!register) throw new Error('No expected attendance register exists for this class and date.');
            if (!['expected', 'in_progress', 'reopened'].includes(register.status)) {
                throw new Error('This attendance register cannot be submitted in its current state.');
            }

            const actor = await db.get(
                'SELECT id FROM staff WHERE id = ? AND school_id = ?',
                [actorStaffId, schoolId], client
            );
            if (!actor) throw new Error('The staff member submitting this register does not belong to this school.');

            const roster = await db.get(`
                SELECT COUNT(*) AS count
                FROM attendance_register_students
                WHERE register_id = ?
            `, [register.id], client);
            const rosterCount = Number(roster.count);
            if (rosterCount === 0) throw new Error('This register has an empty expected roster and requires administrative review.');
            if (rosterCount !== Number(register.expected_student_count)) {
                throw new Error('The saved expected-student count does not match the roster snapshot. Submission is blocked for review.');
            }

            const missing = await db.get(`
                SELECT COUNT(*) AS count
                FROM attendance_register_students rs
                LEFT JOIN attendance a
                  ON a.student_id = rs.student_id
                 AND a.class_id = ?
                 AND a.section_id = ?
                 AND a.date = ?
                 AND a.session = ?
                 AND a.term = ?
                 AND a.status IN ('Present', 'Absent', 'Late', 'Leave')
                WHERE rs.register_id = ? AND a.id IS NULL
            `, [classId, register.section_id, registerDate, register.session, register.term, register.id], client);
            if (Number(missing.count) > 0) {
                throw new Error(Number(missing.count) + ' student(s) are still unmarked. Save a deliberate status for every student before submitting.');
            }

            const extra = await db.get(`
                SELECT COUNT(*) AS count
                FROM attendance a
                WHERE a.class_id = ? AND a.section_id = ? AND a.date = ?
                  AND a.session = ? AND a.term = ?
                  AND NOT EXISTS (
                    SELECT 1 FROM attendance_register_students rs
                    WHERE rs.register_id = ? AND rs.student_id = a.student_id
                  )
            `, [classId, register.section_id, registerDate, register.session, register.term, register.id], client);
            if (Number(extra.count) > 0) {
                throw new Error('Attendance records exist for students outside the expected roster. Resolve the roster mismatch before submitting.');
            }

            const eventType = register.first_submitted_at ? 'resubmitted' : 'submitted';
            await db.run(`
                UPDATE attendance_registers
                SET status = 'submitted',
                    submitted_student_count = expected_student_count,
                    submitted_by = ?,
                    first_submitted_at = COALESCE(first_submitted_at, CURRENT_TIMESTAMP),
                    last_submitted_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [actorStaffId, register.id], client);

            await db.run(`
                INSERT INTO attendance_register_events
                    (register_id, event_type, actor_staff_id, previous_status, new_status, metadata)
                VALUES (?, ?, ?, ?, 'submitted', ?)
            `, [register.id, eventType, actorStaffId, register.status, JSON.stringify({
                submitted_student_count: rosterCount
            })], client);

            return {
                registerId: register.id,
                status: 'submitted',
                submittedStudentCount: rosterCount,
                eventType
            };
        });
    }

    return { isFoundationAvailable, getRegisterContext, saveRegisterProgress, submitRegister };
}

let defaultService = null;
function getDefaultService() {
    if (!defaultService) defaultService = createAttendanceRegisterWorkflowService(require('../utils/db'));
    return defaultService;
}

module.exports = {
    createAttendanceRegisterWorkflowService,
    isFoundationAvailable: (...args) => getDefaultService().isFoundationAvailable(...args),
    getRegisterContext: (...args) => getDefaultService().getRegisterContext(...args),
    saveRegisterProgress: (...args) => getDefaultService().saveRegisterProgress(...args),
    submitRegister: (...args) => getDefaultService().submitRegister(...args),
    VALID_STATUSES: Array.from(VALID_STATUSES),
    UNMARKED_STATUS
};
