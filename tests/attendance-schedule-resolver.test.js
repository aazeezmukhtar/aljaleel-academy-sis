'use strict';

const assert = require('assert');
const {
    createAttendanceScheduleResolver,
    normalizeWeekdays,
    isoWeekday
} = require('../services/attendanceScheduleResolver');

function makeDb({ classSets = [], sectionSets = [], days = [] } = {}) {
    const calls = [];
    return {
        calls,
        async all(sql, params) {
            calls.push({ sql, params });
            if (sql.includes("scope_type = 'class'")) return classSets;
            if (sql.includes("scope_type = 'section'")) return sectionSets;
            if (sql.includes('FROM attendance_schedule_days')) return days;
            return [];
        }
    };
}

(async () => {
    assert.deepStrictEqual(normalizeWeekdays([5, 1, 3]), [1, 3, 5]);
    assert.throws(() => normalizeWeekdays([]), /at least one/);
    assert.throws(() => normalizeWeekdays([1, 1]), /more than once/);
    assert.throws(() => normalizeWeekdays([0]), /weekday numbers/);
    assert.strictEqual(isoWeekday('2026-11-20'), 5);

    const base = { schoolId: 1, sectionId: 2, classId: 30, date: '2026-11-20' };
    const sectionDb = makeDb({
        sectionSets: [{ id: 10, scope_type: 'section', effective_from: '2026-09-01', effective_to: null }],
        days: [{ weekday: 6 }, { weekday: 7 }, { weekday: 1 }, { weekday: 2 }, { weekday: 3 }]
    });
    const inherited = await createAttendanceScheduleResolver(sectionDb).resolve(base);
    assert.strictEqual(inherited.configured, true);
    assert.strictEqual(inherited.source, 'section');
    assert.strictEqual(inherited.scheduleSetId, 10);
    assert.deepStrictEqual(inherited.weekdays, [1, 2, 3, 6, 7]);
    assert.strictEqual(inherited.isOpenDay, false, 'Friday is not in the Tahfeez default');
    assert.strictEqual(sectionDb.calls.length, 3, 'section schedule is queried only after no class override exists');

    const overrideDb = makeDb({
        classSets: [{ id: 11, scope_type: 'class', effective_from: '2026-09-01', effective_to: null }],
        sectionSets: [{ id: 10, scope_type: 'section', effective_from: '2026-09-01', effective_to: null }],
        days: [{ weekday: 4 }, { weekday: 5 }, { weekday: 6 }, { weekday: 7 }]
    });
    const overridden = await createAttendanceScheduleResolver(overrideDb).resolve(base);
    assert.strictEqual(overridden.source, 'class');
    assert.deepStrictEqual(overridden.weekdays, [4, 5, 6, 7]);
    assert.strictEqual(overridden.isOpenDay, true);
    assert.strictEqual(overrideDb.calls.length, 2, 'a class override replaces the section default');

    const missing = await createAttendanceScheduleResolver(makeDb()).resolve(base);
    assert.deepStrictEqual(missing, {
        configured: false, source: null, scheduleSetId: null, weekdays: [], isOpenDay: false
    });

    await assert.rejects(
        () => createAttendanceScheduleResolver(makeDb({
            classSets: [
                { id: 1, scope_type: 'class', effective_from: '2026-01-01' },
                { id: 2, scope_type: 'class', effective_from: '2026-02-01' }
            ]
        })).resolve(base),
        /Conflicting class-specific/
    );
    await assert.rejects(
        () => createAttendanceScheduleResolver(makeDb({
            sectionSets: [
                { id: 1, scope_type: 'section', effective_from: '2026-01-01' },
                { id: 2, scope_type: 'section', effective_from: '2026-02-01' }
            ]
        })).resolve(base),
        /Conflicting section/
    );
    await assert.rejects(
        () => createAttendanceScheduleResolver(makeDb({
            sectionSets: [{ id: 10, scope_type: 'section', effective_from: '2026-09-01' }],
            days: []
        })).resolve(base),
        /invalid or has no weekdays/
    );
    await assert.rejects(
        () => createAttendanceScheduleResolver(makeDb()).resolve({ ...base, date: '2026-02-30' }),
        /valid calendar date/
    );
    console.log('[attendance-schedule-resolver] inheritance, replacement overrides, missing schedules and conflict validation passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
