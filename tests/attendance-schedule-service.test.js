'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { createAttendanceScheduleService, normalizeWeekdays, isoWeekday } =
    require('../services/attendanceScheduleService');

function makeDb() {
    const data = {
        classes: [{ id: 10, school_id: 1, section_id: 1 }, { id: 20, school_id: 1, section_id: 2 }],
        sets: [],
        days: [],
        nextId: 1
    };
    return {
        data,
        DB_TYPE: 'sqlite',
        async transaction(fn) { return fn({}); },
        async get(sql, params) {
            if (sql.includes('FROM classes')) return data.classes.find(row =>
                row.id === Number(params[0]) && row.school_id === Number(params[1])) || null;
            return null;
        },
        async all(sql, params) {
            if (!sql.includes('FROM attendance_schedule_sets')) return [];
            const [schoolId, sectionId, scopeType] = params;
            const classId = scopeType === 'class' ? Number(params[3]) : null;
            const date = scopeType === 'class' ? params[4] : params[3];
            const endDate = scopeType === 'class' ? params[5] : params[4];
            const rows = [];
            for (const set of data.sets) {
                if (set.school_id !== Number(schoolId) || set.section_id !== Number(sectionId) ||
                    set.scope_type !== scopeType || set.class_id !== classId ||
                    set.effective_from > date || (set.effective_to && set.effective_to < endDate)) continue;
                const weekdays = data.days.filter(day => day.schedule_set_id === set.id);
                if (!weekdays.length) rows.push({ schedule_set_id: set.id, scope_type: set.scope_type,
                    effective_from: set.effective_from, effective_to: set.effective_to, weekday: null });
                for (const day of weekdays) rows.push({ schedule_set_id: set.id, scope_type: set.scope_type,
                    effective_from: set.effective_from, effective_to: set.effective_to, weekday: day.weekday });
            }
            return rows;
        },
        async run() { return { changes: 1 }; }
    };
}

(async () => {
    assert.deepStrictEqual(normalizeWeekdays([5, 1, 3]), [1, 3, 5]);
    assert.throws(() => normalizeWeekdays([]), /at least one/);
    assert.throws(() => normalizeWeekdays([1, 1]), /more than once/);
    assert.throws(() => normalizeWeekdays([8]), /ISO weekday/);
    assert.strictEqual(isoWeekday('2026-11-23'), 1);

    const db = makeDb();
    db.data.sets.push(
        { id: 1, school_id: 1, section_id: 1, class_id: null, scope_type: 'section',
            effective_from: '2026-09-01', effective_to: null },
        { id: 2, school_id: 1, section_id: 1, class_id: 10, scope_type: 'class',
            effective_from: '2026-11-01', effective_to: '2026-11-30' },
        { id: 3, school_id: 1, section_id: 2, class_id: null, scope_type: 'section',
            effective_from: '2026-09-01', effective_to: null }
    );
    db.data.days.push(
        ...[1, 2, 3, 4, 5].map(weekday => ({ schedule_set_id: 1, weekday })),
        ...[4, 5, 6, 7].map(weekday => ({ schedule_set_id: 2, weekday })),
        ...[6, 7, 1, 2, 3].map(weekday => ({ schedule_set_id: 3, weekday }))
    );

    const service = createAttendanceScheduleService(db);
    const inherited = await service.resolveSchedule({ schoolId: 1, classId: 10, date: '2026-10-20' });
    assert.strictEqual(inherited.source, 'section_default');
    assert.deepStrictEqual(inherited.weekdays, [1, 2, 3, 4, 5]);

    const overridden = await service.resolveSchedule({ schoolId: 1, classId: 10, date: '2026-11-20' });
    assert.strictEqual(overridden.source, 'class_override');
    assert.deepStrictEqual(overridden.weekdays, [4, 5, 6, 7], 'override replaces rather than adds to section days');

    const resumes = await service.resolveSchedule({ schoolId: 1, classId: 10, date: '2026-12-01' });
    assert.strictEqual(resumes.source, 'section_default');
    assert.deepStrictEqual(resumes.weekdays, [1, 2, 3, 4, 5]);

    const otherSection = await service.resolveSchedule({ schoolId: 1, classId: 20, date: '2026-11-21' });
    assert.strictEqual(otherSection.source, 'section_default');
    assert.deepStrictEqual(otherSection.weekdays, [6, 7, 1, 2, 3]);

    const expectedMonday = await service.isExpectedSchoolDay({ schoolId: 1, classId: 10, date: '2026-12-07' });
    assert.strictEqual(expectedMonday.expected, true);
    assert.strictEqual(expectedMonday.source, 'section_default');

    db.data.sets.push({ id: 4, school_id: 1, section_id: 1, class_id: null,
        scope_type: 'section', effective_from: '2026-09-01', effective_to: null });
    db.data.days.push({ schedule_set_id: 4, weekday: 1 });
    await assert.rejects(
        service.resolveSchedule({ schoolId: 1, classId: 10, date: '2026-10-20' }),
        error => error.code === 'SCHEDULE_CONFLICT'
    );

    console.log('[attendance-schedule-service] inheritance, full replacement, date fallback, section isolation, expected weekdays and fail-closed conflicts passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
