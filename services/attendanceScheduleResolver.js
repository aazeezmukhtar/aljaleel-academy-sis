'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeScheduleDate(value) {
    const date = String(value || '').trim();
    if (!DATE_RE.test(date)) throw new Error('Schedule date must use YYYY-MM-DD format.');
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Schedule date is not a valid calendar date.');
    }
    return date;
}

function normalizeWeekdays(values) {
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Choose at least one opening day.');
    }
    const days = values.map(Number);
    if (days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
        throw new Error('Opening days must use weekday numbers 1 (Monday) through 7 (Sunday).');
    }
    if (new Set(days).size !== days.length) throw new Error('An opening day cannot be selected more than once.');
    return days.sort((a, b) => a - b);
}

function createAttendanceScheduleResolver(db) {
    if (!db) throw new Error('Attendance schedule resolver requires a database adapter.');

    async function resolve(input, client = null) {
        const schoolId = Number(input && input.schoolId);
        const sectionId = Number(input && input.sectionId);
        const classId = Number(input && input.classId);
        const date = normalizeScheduleDate(input && input.date);
        if (![schoolId, sectionId, classId].every(n => Number.isSafeInteger(n) && n > 0)) {
            throw new Error('A valid school, section and class are required to resolve opening days.');
        }

        const classSets = await db.all(`
            SELECT id, scope_type, section_id, class_id, effective_from, effective_to
            FROM attendance_schedule_sets
            WHERE school_id = ? AND section_id = ? AND class_id = ?
              AND scope_type = 'class'
              AND effective_from <= ?
              AND (effective_to IS NULL OR effective_to >= ?)
            ORDER BY effective_from DESC, id DESC
        `, [schoolId, sectionId, classId, date, date], client);

        let selected;
        if (classSets.length > 1) {
            throw new Error('Conflicting class-specific opening-day schedules cover this date.');
        }
        if (classSets.length === 1) {
            selected = classSets[0];
        } else {
            const sectionSets = await db.all(`
                SELECT id, scope_type, section_id, class_id, effective_from, effective_to
                FROM attendance_schedule_sets
                WHERE school_id = ? AND section_id = ? AND class_id IS NULL
                  AND scope_type = 'section'
                  AND effective_from <= ?
                  AND (effective_to IS NULL OR effective_to >= ?)
                ORDER BY effective_from DESC, id DESC
            `, [schoolId, sectionId, date, date], client);
            if (sectionSets.length > 1) {
                throw new Error('Conflicting section opening-day schedules cover this date.');
            }
            selected = sectionSets[0] || null;
        }

        if (!selected) return { configured: false, source: null, scheduleSetId: null, weekdays: [], isOpenDay: false };

        const dayRows = await db.all(
            'SELECT weekday FROM attendance_schedule_days WHERE schedule_set_id = ? ORDER BY weekday',
            [selected.id], client
        );
        const weekdays = dayRows.map(row => Number(row.weekday));
        if (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)
            || new Set(weekdays).size !== weekdays.length) {
            throw new Error('The effective opening-day schedule is invalid or has no weekdays.');
        }
        return {
            configured: true,
            source: selected.scope_type,
            scheduleSetId: selected.id,
            effectiveFrom: String(selected.effective_from).slice(0, 10),
            effectiveTo: selected.effective_to ? String(selected.effective_to).slice(0, 10) : null,
            weekdays,
            isOpenDay: weekdays.includes(isoWeekday(date))
        };
    }

    return { resolve };
}

function isoWeekday(date) {
    const day = new Date(date + 'T00:00:00Z').getUTCDay();
    return day === 0 ? 7 : day;
}

module.exports = {
    createAttendanceScheduleResolver,
    normalizeScheduleDate,
    normalizeWeekdays,
    isoWeekday
};
