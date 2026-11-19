'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
    const date = String(value || '').trim();
    if (!DATE_RE.test(date)) throw new Error('Attendance register date must use YYYY-MM-DD format.');
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Attendance register date is not a valid calendar date.');
    }
    return date;
}

function createAttendanceRegisterAdministrationService(db) {
    if (!db) throw new Error('An attendance register database adapter is required.');

    async function reopenRegister(input) {
        const schoolId = Number(input && input.schoolId);
        const classId = Number(input && input.classId);
        const registerDate = normalizeDate(input && input.registerDate);
        const actorStaffId = Number(input && input.actorStaffId);
        const reason = String(input && input.reason || '').trim();

        if (![schoolId, classId, actorStaffId].every(value =>
            Number.isSafeInteger(value) && value > 0
        )) {
            throw new Error('A valid school, class and staff member are required to reopen this register.');
        }
        if (!reason || reason.length > 500) {
            throw new Error('A correction reason is required and must not exceed 500 characters.');
        }

        return db.transaction(async client => {
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
            const register = await db.get(`
                SELECT id, section_id, status, expected_student_count,
                       submitted_student_count, submitted_by,
                       first_submitted_at, last_submitted_at
                FROM attendance_registers
                WHERE school_id = ? AND class_id = ? AND register_date = ?
                ${lock}
            `, [schoolId, classId, registerDate], client);

            if (!register) throw new Error('No attendance register exists for this class and date.');
            if (register.status !== 'submitted') {
                throw new Error('Only a submitted attendance register can be reopened. Current status: ' + register.status + '.');
            }

            const actor = await db.get(
                'SELECT id, role FROM staff WHERE id = ? AND school_id = ?',
                [actorStaffId, schoolId], client
            );
            if (!actor) throw new Error('The administrator does not belong to this school.');
            if (actor.role !== 'Admin') {
                throw new Error('Only an administrator may reopen a submitted attendance register.');
            }

            const before = {
                status: register.status,
                expected_student_count: Number(register.expected_student_count),
                submitted_student_count: Number(register.submitted_student_count),
                submitted_by: register.submitted_by,
                first_submitted_at: register.first_submitted_at,
                last_submitted_at: register.last_submitted_at
            };
            const after = {
                status: 'reopened',
                expected_student_count: Number(register.expected_student_count),
                submitted_student_count: 0,
                submitted_by: null
            };

            await db.run(`
                UPDATE attendance_registers
                SET status = 'reopened',
                    submitted_student_count = 0,
                    submitted_by = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [register.id], client);

            await db.run(`
                INSERT INTO attendance_register_events
                    (register_id, event_type, actor_staff_id, previous_status, new_status, reason, metadata)
                VALUES (?, 'reopened', ?, 'submitted', 'reopened', ?, ?)
            `, [register.id, actorStaffId, reason, JSON.stringify({
                previous_submitted_by: register.submitted_by,
                previous_submitted_student_count: Number(register.submitted_student_count),
                previous_last_submitted_at: register.last_submitted_at
            })], client);

            await db.run(`
                INSERT INTO attendance_foundation_audit_logs
                    (entity_type, entity_id, action, actor_staff_id, before_data, after_data, reason)
                VALUES ('attendance_register', ?, 'register_reopened', ?, ?, ?, ?)
            `, [
                register.id,
                actorStaffId,
                JSON.stringify(before),
                JSON.stringify(after),
                reason
            ], client);

            return {
                registerId: register.id,
                status: 'reopened',
                expectedStudentCount: Number(register.expected_student_count),
                submittedStudentCount: 0,
                reason
            };
        });
    }

    return { reopenRegister };
}

let defaultService = null;
function getDefaultService() {
    if (!defaultService) {
        defaultService = createAttendanceRegisterAdministrationService(require('../utils/db'));
    }
    return defaultService;
}

module.exports = {
    createAttendanceRegisterAdministrationService,
    reopenRegister: (...args) => getDefaultService().reopenRegister(...args)
};
