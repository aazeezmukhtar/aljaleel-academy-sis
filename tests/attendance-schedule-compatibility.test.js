'use strict';

const assert = require('assert');
const { createAttendanceScheduleCompatibilityService } =
    require('../services/attendanceScheduleCompatibilityService');

(async () => {
    let legacyRows = [{ id: 71, weekday: 5 }];
    const db = {
        DB_TYPE: 'sqlite',
        async get(sql) {
            assert.ok(sql.includes('sqlite_master'));
            return { table_count: 0 };
        },
        async all(sql, params) {
            assert.ok(sql.includes('FROM class_attendance_schedules'));
            assert.deepStrictEqual(params, [1, 4, 2, 5, '2026-11-20', '2026-11-20']);
            return legacyRows;
        }
    };
    const service = createAttendanceScheduleCompatibilityService(db);
    const input = { schoolId: 1, classId: 4, sectionId: 2, date: '2026-11-20' };

    const expected = await service.isExpectedSchoolDay(input);
    assert.strictEqual(expected.expected, true);
    assert.strictEqual(expected.scheduleId, 71);
    assert.strictEqual(expected.scheduleSetId, null);
    assert.strictEqual(expected.scheduleFoundationAvailable, false);
    assert.strictEqual(expected.source, 'legacy_class_schedule');

    legacyRows = [];
    const nonSchoolDay = await service.isExpectedSchoolDay(input);
    assert.strictEqual(nonSchoolDay.expected, false);
    assert.strictEqual(nonSchoolDay.reason, 'not_a_scheduled_day');

    legacyRows = [{ id: 71, weekday: 5 }, { id: 72, weekday: 5 }];
    await assert.rejects(service.isExpectedSchoolDay(input), error => error.code === 'SCHEDULE_CONFLICT');

    console.log('Attendance schedule compatibility tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
