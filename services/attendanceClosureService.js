'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value, label) {
    const date = String(value || '').trim();
    if (!DATE_RE.test(date)) throw new Error((label || 'Date') + ' must use YYYY-MM-DD format.');
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error((label || 'Date') + ' is not a valid calendar date.');
    }
    return date;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
}

function scopesIntersect(a, b) {
    if (a.scope_type === 'school' || b.scope_type === 'school') return true;
    if (String(a.section_id) !== String(b.section_id)) return false;
    if (a.scope_type === 'section' || b.scope_type === 'section') return true;
    return String(a.class_id) === String(b.class_id);
}

function createAttendanceClosureService(db) {
    if (!db) throw new Error('An attendance closure database adapter is required.');

    async function getActor(actorStaffId, schoolId, client) {
        const actor = await db.get(
            'SELECT id, role FROM staff WHERE id = ? AND school_id = ?',
            [actorStaffId, schoolId], client
        );
        if (!actor) throw new Error('The staff member does not belong to this school.');
        return actor;
    }

    async function validateScope(input, client) {
        const scopeType = String(input.scopeType || '').trim();
        if (!['school', 'section', 'class'].includes(scopeType)) {
            throw new Error('Choose a valid closure scope.');
        }
        let sectionId = null;
        let classId = null;
        if (scopeType === 'section') {
            sectionId = Number(input.sectionId);
            if (!Number.isSafeInteger(sectionId) || sectionId <= 0) throw new Error('A valid section is required.');
            const section = await db.get('SELECT id FROM sections WHERE id = ? AND school_id = ?', [sectionId, input.schoolId], client);
            if (!section) throw new Error('The selected section does not belong to this school.');
        }
        if (scopeType === 'class') {
            classId = Number(input.classId);
            if (!Number.isSafeInteger(classId) || classId <= 0) throw new Error('A valid class is required.');
            const clazz = await db.get(
                'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
                [classId, input.schoolId], client
            );
            if (!clazz || !clazz.section_id) throw new Error('The selected class is not configured in this school.');
            sectionId = Number(clazz.section_id);
        }
        return { scope_type: scopeType, section_id: sectionId, class_id: classId };
    }

    async function findConflicts(scope, startDate, endDate, schoolId, client, excludeId) {
        const excludeClause = excludeId ? ' AND id <> ?' : '';
        const params = [schoolId, endDate, startDate];
        if (excludeId) params.push(excludeId);
        const rows = await db.all(`
            SELECT id, scope_type, section_id, class_id, start_date, end_date, status
            FROM class_attendance_closures
            WHERE school_id = ? AND status IN ('pending', 'approved')
              AND start_date <= ? AND end_date >= ?${excludeClause}
            ORDER BY id
        `, params, client);
        return rows.filter(row => scopesIntersect(scope, row) &&
            overlaps(startDate, endDate, row.start_date, row.end_date));
    }

    async function requestClosure(input) {
        const schoolId = Number(input && input.schoolId);
        const actorStaffId = Number(input && input.actorStaffId);
        const startDate = normalizeDate(input && input.startDate, 'Start date');
        const endDate = normalizeDate(input && input.endDate, 'End date');
        const reason = String(input && input.reason || '').trim();
        if (![schoolId, actorStaffId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school and requesting staff member are required.');
        }
        if (endDate < startDate) throw new Error('The closure end date cannot be earlier than its start date.');
        if (!reason || reason.length > 500) throw new Error('A closure reason is required and must not exceed 500 characters.');

        return db.transaction(async client => {
            const actor = await getActor(actorStaffId, schoolId, client);
            const scope = await validateScope({ ...input, schoolId }, client);
            if (actor.role !== 'Admin') {
                if (scope.scope_type !== 'class') {
                    throw new Error('Only an administrator may request a school-wide or section-wide closure.');
                }
                const responsibility = await db.get(`
                    SELECT id FROM class_attendance_responsibilities
                    WHERE school_id = ? AND class_id = ? AND section_id = ? AND staff_id = ?
                      AND responsibility_type IN ('primary', 'substitute')
                      AND effective_from <= ?
                      AND (effective_to IS NULL OR effective_to >= ?)
                    LIMIT 1
                `, [schoolId, scope.class_id, scope.section_id, actorStaffId, startDate, endDate], client);
                if (!responsibility) {
                    throw new Error('Only the responsible class teacher or an administrator may request a class closure.');
                }
            }

            const conflicts = await findConflicts(scope, startDate, endDate, schoolId, client);
            if (conflicts.length) {
                throw new Error('An overlapping pending or approved closure already exists for this scope and date range.');
            }

            const inserted = await db.get(`
                INSERT INTO class_attendance_closures
                    (school_id, scope_type, section_id, class_id, start_date, end_date,
                     reason, status, requested_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                RETURNING id
            `, [schoolId, scope.scope_type, scope.section_id, scope.class_id,
                startDate, endDate, reason, actorStaffId], client);
            const closureId = inserted.id;
            await db.run(`
                INSERT INTO attendance_foundation_audit_logs
                    (entity_type, entity_id, action, actor_staff_id, after_data, reason)
                VALUES ('attendance_closure', ?, 'closure_requested', ?, ?, ?)
            `, [closureId, actorStaffId, JSON.stringify({
                ...scope, start_date: startDate, end_date: endDate, status: 'pending'
            }), reason], client);
            return { closureId, status: 'pending', ...scope, startDate, endDate, reason };
        });
    }

    async function listClosures(input) {
        const schoolId = Number(input && input.schoolId);
        const status = input && input.status ? String(input.status) : null;
        if (!Number.isSafeInteger(schoolId) || schoolId <= 0) throw new Error('A valid school is required.');
        if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
            throw new Error('Invalid closure status filter.');
        }
        const rows = await db.all(`
            SELECT cl.*, req.first_name AS requester_first_name, req.last_name AS requester_last_name,
                   approver.first_name AS approver_first_name, approver.last_name AS approver_last_name,
                   sec.name AS section_name, c.name AS class_name
            FROM class_attendance_closures cl
            JOIN staff req ON req.id = cl.requested_by AND req.school_id = cl.school_id
            LEFT JOIN staff approver ON approver.id = cl.approved_by AND approver.school_id = cl.school_id
            LEFT JOIN sections sec ON sec.id = cl.section_id AND sec.school_id = cl.school_id
            LEFT JOIN classes c ON c.id = cl.class_id AND c.school_id = cl.school_id
            WHERE cl.school_id = ? AND (? IS NULL OR cl.status = ?)
            ORDER BY CASE cl.status WHEN 'pending' THEN 0 ELSE 1 END, cl.start_date DESC, cl.id DESC
            LIMIT 200
        `, [schoolId, status, status]);
        return rows;
    }

    async function decideClosure(input) {
        const schoolId = Number(input && input.schoolId);
        const closureId = Number(input && input.closureId);
        const actorStaffId = Number(input && input.actorStaffId);
        const decision = String(input && input.decision || '').trim();
        const reason = String(input && input.reason || '').trim();
        if (![schoolId, closureId, actorStaffId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school, closure and administrator are required.');
        }
        if (!['approved', 'rejected'].includes(decision)) throw new Error('Choose approve or reject.');
        if (decision === 'rejected' && (!reason || reason.length > 500)) {
            throw new Error('A rejection reason is required and must not exceed 500 characters.');
        }

        return db.transaction(async client => {
            const actor = await getActor(actorStaffId, schoolId, client);
            if (actor.role !== 'Admin') throw new Error('Only an administrator may approve or reject a closure request.');
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
            const closure = await db.get(`
                SELECT * FROM class_attendance_closures
                WHERE id = ? AND school_id = ? ${lock}
            `, [closureId, schoolId], client);
            if (!closure) throw new Error('The closure request was not found in this school.');
            if (closure.status !== 'pending') throw new Error('Only a pending closure request can be decided.');

            if (decision === 'approved') {
                const conflicts = await findConflicts(closure, closure.start_date, closure.end_date, schoolId, client, closureId);
                if (conflicts.some(row => row.status === 'approved')) {
                    throw new Error('This request overlaps an already approved closure. Resolve the conflict before approval.');
                }
            }

            const nextStatus = decision;
            await db.run(`
                UPDATE class_attendance_closures
                SET status = ?, approved_by = ?, approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END
                WHERE id = ? AND school_id = ? AND status = 'pending'
            `, [nextStatus, actorStaffId, nextStatus, closureId, schoolId], client);
            const after = {
                status: nextStatus, approved_by: decision === 'approved' ? actorStaffId : null,
                approved_at: decision === 'approved' ? 'CURRENT_TIMESTAMP' : null
            };
            await db.run(`
                INSERT INTO attendance_foundation_audit_logs
                    (entity_type, entity_id, action, actor_staff_id, before_data, after_data, reason)
                VALUES ('attendance_closure', ?, ?, ?, ?, ?, ?)
            `, [closureId, decision === 'approved' ? 'closure_approved' : 'closure_rejected',
                actorStaffId, JSON.stringify({ status: closure.status }),
                JSON.stringify(after), reason || closure.reason], client);
            return { closureId, status: nextStatus };
        });
    }

    async function cancelClosure(input) {
        const schoolId = Number(input && input.schoolId);
        const closureId = Number(input && input.closureId);
        const actorStaffId = Number(input && input.actorStaffId);
        if (![schoolId, closureId, actorStaffId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school, closure and staff member are required.');
        }
        return db.transaction(async client => {
            const actor = await getActor(actorStaffId, schoolId, client);
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
            const closure = await db.get(`
                SELECT * FROM class_attendance_closures
                WHERE id = ? AND school_id = ? ${lock}
            `, [closureId, schoolId], client);
            if (!closure) throw new Error('The closure request was not found in this school.');
            if (closure.status !== 'pending') throw new Error('Only a pending closure request can be cancelled.');
            if (actor.role !== 'Admin' && String(closure.requested_by) !== String(actorStaffId)) {
                throw new Error('Only the requester or an administrator may cancel this request.');
            }
            await db.run(
                "UPDATE class_attendance_closures SET status = 'cancelled' WHERE id = ? AND school_id = ?",
                [closureId, schoolId], client
            );
            await db.run(`
                INSERT INTO attendance_foundation_audit_logs
                    (entity_type, entity_id, action, actor_staff_id, before_data, after_data)
                VALUES ('attendance_closure', ?, 'closure_cancelled', ?, ?, ?)
            `, [closureId, actorStaffId, JSON.stringify({ status: 'pending' }),
                JSON.stringify({ status: 'cancelled' })], client);
            return { closureId, status: 'cancelled' };
        });
    }

    return { requestClosure, listClosures, decideClosure, cancelClosure };
}

let defaultService = null;
function getDefaultService() {
    if (!defaultService) defaultService = createAttendanceClosureService(require('../utils/db'));
    return defaultService;
}

module.exports = {
    createAttendanceClosureService,
    requestClosure: (...args) => getDefaultService().requestClosure(...args),
    listClosures: (...args) => getDefaultService().listClosures(...args),
    decideClosure: (...args) => getDefaultService().decideClosure(...args),
    cancelClosure: (...args) => getDefaultService().cancelClosure(...args)
};
