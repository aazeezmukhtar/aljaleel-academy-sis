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

function normalizeWeekdays(values) {
    if (!Array.isArray(values) || !values.length) throw new Error('Choose at least one opening weekday.');
    const days = values.map(Number);
    if (days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
        throw new Error('Opening weekdays must use ISO weekday numbers from 1 (Monday) to 7 (Sunday).');
    }
    if (new Set(days).size !== days.length) throw new Error('An opening weekday cannot be selected more than once.');
    return days.sort((a, b) => a - b);
}

function isoWeekday(value) {
    const date = normalizeDate(value, 'Schedule date');
    const day = new Date(date + 'T00:00:00Z').getUTCDay();
    return day === 0 ? 7 : day;
}

function scheduleError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function createAttendanceScheduleService(db) {
    if (!db) throw new Error('An attendance schedule database adapter is required.');

    async function admin(input, client) {
        const schoolId = Number(input.schoolId), actorStaffId = Number(input.actorStaffId);
        if (![schoolId, actorStaffId].every(n => Number.isSafeInteger(n) && n > 0)) {
            throw new Error('A valid school and administrator are required.');
        }
        const actor = await db.get('SELECT id, role FROM staff WHERE id = ? AND school_id = ?',
            [actorStaffId, schoolId], client);
        if (!actor || actor.role !== 'Admin') throw new Error('Only a school administrator may manage attendance schedules.');
        if (db.DB_TYPE === 'postgres') await db.get('SELECT id FROM schools WHERE id = ? FOR UPDATE', [schoolId], client);
        return { schoolId, actorStaffId };
    }

    async function validateOwnership(schoolId, scopeType, sectionId, classId, client) {
        const section = await db.get('SELECT id FROM sections WHERE id = ? AND school_id = ?',
            [sectionId, schoolId], client);
        if (!section) throw new Error('The selected section does not belong to this school.');
        if (scopeType === 'class') {
            const clazz = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ? AND section_id = ?',
                [classId, schoolId, sectionId], client);
            if (!clazz) throw new Error('The selected class does not belong to this school and section.');
        }
    }

    async function audit(client, id, action, actor, before, after, reason) {
        await db.run(
            'INSERT INTO attendance_foundation_audit_logs ' +
            '(entity_type, entity_id, action, actor_staff_id, before_data, after_data, reason) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['attendance_schedule_set', id, action, actor,
                before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason || null],
            client
        );
    }

    async function findEffectiveSets(schoolId, sectionId, scopeType, classId, date, client) {
        const classClause = scopeType === 'class' ? 'ss.class_id = ?' : 'ss.class_id IS NULL';
        const params = scopeType === 'class'
            ? [schoolId, sectionId, scopeType, classId, date, date]
            : [schoolId, sectionId, scopeType, date, date];
        const rows = await db.all(
            'SELECT ss.id AS schedule_set_id, ss.scope_type, ss.effective_from, ss.effective_to, sd.weekday ' +
            'FROM attendance_schedule_sets ss ' +
            'LEFT JOIN attendance_schedule_days sd ON sd.schedule_set_id = ss.id ' +
            'WHERE ss.school_id = ? AND ss.section_id = ? AND ss.scope_type = ? AND ' + classClause +
            ' AND ss.effective_from <= ? AND (ss.effective_to IS NULL OR ss.effective_to >= ?) ' +
            'ORDER BY ss.id, sd.weekday',
            params, client
        );
        const sets = new Map();
        for (const row of rows) {
            const id = String(row.schedule_set_id);
            if (!sets.has(id)) sets.set(id, {
                scheduleSetId: row.schedule_set_id, scopeType: row.scope_type,
                effectiveFrom: String(row.effective_from).slice(0, 10),
                effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
                weekdays: []
            });
            if (row.weekday !== null && row.weekday !== undefined) sets.get(id).weekdays.push(Number(row.weekday));
        }
        return Array.from(sets.values());
    }

    async function resolveSchedule(input, client) {
        const schoolId = Number(input && input.schoolId), classId = Number(input && input.classId);
        const date = normalizeDate(input && input.date, 'Schedule date');
        if (![schoolId, classId].every(n => Number.isSafeInteger(n) && n > 0)) {
            throw new Error('A valid school and class are required to resolve an attendance schedule.');
        }
        const clazz = await db.get('SELECT id, school_id, section_id FROM classes WHERE id = ? AND school_id = ?',
            [classId, schoolId], client);
        if (!clazz) throw scheduleError('CLASS_NOT_FOUND', 'The selected class does not belong to this school.');

        const classSets = await findEffectiveSets(schoolId, clazz.section_id, 'class', classId, date, client);
        if (classSets.length > 1) throw scheduleError('SCHEDULE_CONFLICT',
            'More than one class override is effective for this class and date.');
        let selected = classSets[0] || null;
        if (!selected) {
            const sectionSets = await findEffectiveSets(schoolId, clazz.section_id, 'section', null, date, client);
            if (sectionSets.length > 1) throw scheduleError('SCHEDULE_CONFLICT',
                'More than one section default is effective for this section and date.');
            selected = sectionSets[0] || null;
        }
        if (!selected) return {
            configured: false, source: null, scheduleSetId: null, weekdays: [],
            classId, sectionId: clazz.section_id, date, reason: 'missing_schedule'
        };
        if (!selected.weekdays.length) throw scheduleError('SCHEDULE_INVALID',
            'The effective attendance schedule contains no weekdays.');
        return {
            configured: true, source: selected.scopeType === 'class' ? 'class_override' : 'section_default',
            scheduleSetId: selected.scheduleSetId, weekdays: selected.weekdays,
            effectiveFrom: selected.effectiveFrom, effectiveTo: selected.effectiveTo,
            classId, sectionId: clazz.section_id, date
        };
    }

    async function isExpectedSchoolDay(input, client) {
        const schedule = await resolveSchedule(input, client);
        const weekday = isoWeekday(input.date);
        return { ...schedule, weekday, expected: schedule.configured && schedule.weekdays.includes(weekday) };
    }

    async function createScheduleSet(input) {
        const scopeType = String(input && input.scopeType || '');
        if (!['section', 'class'].includes(scopeType)) throw new Error('Choose a section default or class override schedule.');
        const start = normalizeDate(input.effectiveFrom, 'Effective from');
        const end = input.effectiveTo ? normalizeDate(input.effectiveTo, 'Effective to') : null;
        if (end && end < start) throw new Error('Effective to cannot be earlier than effective from.');
        const weekdays = normalizeWeekdays(input.weekdays);
        const sectionId = Number(input.sectionId), classId = scopeType === 'class' ? Number(input.classId) : null;
        if (!Number.isSafeInteger(sectionId) || sectionId <= 0 ||
            (scopeType === 'class' && (!Number.isSafeInteger(classId) || classId <= 0))) {
            throw new Error('Choose a valid section and, for a class override, a valid class.');
        }

        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(input, client);
            await validateOwnership(schoolId, scopeType, sectionId, classId, client);
            const overlaps = await db.all(
                'SELECT id FROM attendance_schedule_sets WHERE school_id = ? AND section_id = ? AND scope_type = ? ' +
                'AND ((class_id = ?) OR (class_id IS NULL AND ? IS NULL)) ' +
                'AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)',
                [schoolId, sectionId, scopeType, classId, classId, end || '9999-12-31', start], client
            );
            if (overlaps.length) throw new Error('Another schedule set at this scope already overlaps these effective dates. End the earlier set first.');

            const registerSql = scopeType === 'class'
                ? 'SELECT id FROM attendance_registers WHERE school_id = ? AND section_id = ? AND class_id = ? AND register_date BETWEEN ? AND ? LIMIT 1'
                : 'SELECT id FROM attendance_registers WHERE school_id = ? AND section_id = ? AND register_date BETWEEN ? AND ? LIMIT 1';
            const registerParams = scopeType === 'class'
                ? [schoolId, sectionId, classId, start, end || '9999-12-31']
                : [schoolId, sectionId, start, end || '9999-12-31'];
            if (await db.get(registerSql, registerParams, client)) {
                throw new Error('This effective date range includes an existing attendance register. Choose a later date or use the separately approved correction workflow.');
            }

            const row = await db.get(
                'INSERT INTO attendance_schedule_sets ' +
                '(school_id, section_id, class_id, scope_type, effective_from, effective_to, created_by) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
                [schoolId, sectionId, classId, scopeType, start, end, actorStaffId], client
            );
            for (const weekday of weekdays) {
                await db.run('INSERT INTO attendance_schedule_days (schedule_set_id, weekday) VALUES (?, ?)',
                    [row.id, weekday], client);
            }
            const after = { school_id: schoolId, section_id: sectionId, class_id: classId,
                scope_type: scopeType, effective_from: start, effective_to: end, weekdays };
            await audit(client, row.id, 'schedule_set_created', actorStaffId, null, after);
            return { id: row.id, ...after };
        });
    }

    async function endScheduleSet(input) {
        const id = Number(input && input.scheduleSetId);
        const end = normalizeDate(input && input.effectiveTo, 'Effective to');
        const reason = String(input && input.reason || '').trim();
        if (!Number.isSafeInteger(id) || id <= 0 || !reason || reason.length > 500) {
            throw new Error('Choose a valid schedule set and provide a reason (maximum 500 characters).');
        }
        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(input, client);
            const before = await db.get(
                'SELECT * FROM attendance_schedule_sets WHERE id = ? AND school_id = ?',
                [id, schoolId], client
            );
            if (!before) throw new Error('The selected schedule set was not found in this school.');
            const beforeDays = await db.all('SELECT weekday FROM attendance_schedule_days WHERE schedule_set_id = ? ORDER BY weekday', [id], client);
            before.weekdays = beforeDays.map(row => Number(row.weekday));
            const start = String(before.effective_from).slice(0, 10);
            if (end < start) throw new Error('Effective to cannot be earlier than the schedule start date.');
            if (before.effective_to && String(before.effective_to).slice(0, 10) <= end) {
                throw new Error('This schedule set already ends on or before the selected date.');
            }
            const classScope = before.scope_type === 'class';
            const registerSql = classScope
                ? 'SELECT id FROM attendance_registers WHERE school_id = ? AND section_id = ? AND class_id = ? AND register_date > ? AND register_date <= ? LIMIT 1'
                : 'SELECT id FROM attendance_registers WHERE school_id = ? AND section_id = ? AND register_date > ? AND register_date <= ? LIMIT 1';
            const registerParams = classScope
                ? [schoolId, before.section_id, before.class_id, end, before.effective_to || '9999-12-31']
                : [schoolId, before.section_id, end, before.effective_to || '9999-12-31'];
            if (await db.get(registerSql, registerParams, client)) {
                throw new Error('Ending this schedule would reinterpret dates with existing registers. Use the separately approved correction workflow.');
            }
            await db.run('UPDATE attendance_schedule_sets SET effective_to = ? WHERE id = ? AND school_id = ?',
                [end, id, schoolId], client);
            await audit(client, id, 'schedule_set_ended', actorStaffId, before,
                { ...before, effective_to: end }, reason);
            return { id, effectiveTo: end };
        });
    }

    return { resolveSchedule, isExpectedSchoolDay, createScheduleSet, endScheduleSet };
}

module.exports = { createAttendanceScheduleService, normalizeDate, normalizeWeekdays, isoWeekday };
