'use strict';

const { createAttendanceScheduleService, isoWeekday } = require('./attendanceScheduleService');

function createAttendanceScheduleCompatibilityService(db) {
    const current = createAttendanceScheduleService(db);

    async function hasScheduleFoundation(client) {
        const result = db.DB_TYPE === 'postgres'
            ? await db.get("SELECT to_regclass('attendance_schedule_sets') AS sets_name, to_regclass('attendance_schedule_days') AS days_name", [], client)
            : await db.get("SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name IN ('attendance_schedule_sets', 'attendance_schedule_days')", [], client);
        return db.DB_TYPE === 'postgres'
            ? !!(result && result.sets_name && result.days_name)
            : !!(result && Number(result.table_count) === 2);
    }

    async function isExpectedSchoolDay(input, client) {
        if (await hasScheduleFoundation(client)) {
            return current.isExpectedSchoolDay(input, client);
        }
        const weekday = isoWeekday(input.date);
        const rows = await db.all(
            'SELECT id, weekday FROM class_attendance_schedules ' +
            'WHERE school_id = ? AND class_id = ? AND section_id = ? AND weekday = ? ' +
            'AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ' +
            'ORDER BY effective_from DESC, id DESC',
            [Number(input.schoolId), Number(input.classId), Number(input.sectionId || 0),
                weekday, input.date, input.date], client
        );
        if (rows.length > 1) {
            const error = new Error('Overlapping legacy attendance schedules cover this class and date.');
            error.code = 'SCHEDULE_CONFLICT';
            throw error;
        }
        if (!rows.length) {
            return { configured: true, expected: false, reason: 'not_a_scheduled_day',
                weekday, scheduleId: null, scheduleSetId: null, source: 'legacy_class_schedule' };
        }
        return { configured: true, expected: true, weekday, scheduleId: rows[0].id,
            scheduleSetId: null, source: 'legacy_class_schedule' };
    }

    return { hasScheduleFoundation, isExpectedSchoolDay };
}

module.exports = { createAttendanceScheduleCompatibilityService };
