'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const setupView = fs.readFileSync(path.resolve(__dirname, '../views/attendance/setup.ejs'), 'utf8');
ejs.compile(setupView);
assertViewDefaults();
function assertViewDefaults() {
    assert.ok(setupView.includes("window.prompt('Enter the last effective date (YYYY-MM-DD):', suggestedEnd)"));
    assert.ok(setupView.includes("const suggestedEnd = todayKey < button.dataset.start ? button.dataset.start : todayKey;"));
    assert.ok(setupView.includes('>Shorten period</button>'));
    assert.ok(setupView.includes('attendanceTodayKey'));
    assert.ok(!setupView.includes("window.prompt('Enter the last effective date (YYYY-MM-DD):', button.dataset.start)"));
    assert.ok(setupView.includes('Setup readiness'));
    assert.ok(setupView.includes('setup.readinessSummary.ready'));
    assert.ok(setupView.includes('setup.readinessSummary.incomplete'));
    assert.ok(setupView.includes("item.missing.join(' · ')"));
}
const { createAttendanceSetupService } = require('../services/attendanceSetupService');

function makeDb() {
    const state = { nextId: 10, audits: [], conflicts: [], inserted: [] };
    return {
        state,
        DB_TYPE: 'sqlite',
        async transaction(fn) { return fn({}); },
        async get(sql, params) {
            if (sql.includes('FROM staff WHERE id = ? AND school_id = ?')) {
                return params[0] === 7 ? { id: 7, role: 'Admin' } : { id: params[0], role: 'Teacher' };
            }
            if (sql.includes('FROM sections WHERE id = ?')) return params[0] === 10 ? { id: 10 } : null;
            if (sql.includes('FROM classes WHERE id = ?')) return params[2] === 10 ? { id: params[0], section_id: 10 } : null;
            if (sql.includes('INSERT INTO') && sql.includes('RETURNING id')) {
                const row = { id: state.nextId++ }; state.inserted.push({ sql, params }); return row;
            }
            if (sql.includes('SELECT id FROM section_academic_periods')) return null;
            if (sql.includes('SELECT * FROM')) return null;
            return null;
        },
        async all(sql) {
            if (sql.includes('SELECT effective_from, effective_to')) return state.conflicts;
            if (sql.includes('SELECT id, start_date, end_date')) return [];
            return [];
        },
        async run(sql, params) {
            if (sql.includes('attendance_foundation_audit_logs')) state.audits.push({ sql, params });
            return { changes: 1 };
        }
    };
}

(async () => {
    const db = makeDb();
    const service = createAttendanceSetupService(db);
    const base = { schoolId: 1, actorStaffId: 7 };
    // Valid date and ownership checks, plus audit writes for each created configuration.
    const period = await service.createAcademicPeriod({ ...base, sectionId: 10, session: '2026/2027', term: '1st Term', startDate: '2026-09-01', endDate: '2026-12-20' });
    assert.ok(period.id);
    const schedule = await service.createSchedule({ ...base, classId: 20, sectionId: 10, weekday: 1, startDate: '2026-09-01' });
    assert.ok(schedule.id);
    const responsibility = await service.createResponsibility({ ...base, classId: 20, sectionId: 10, staffId: 8, responsibilityType: 'primary', startDate: '2026-09-01' });
    assert.ok(responsibility.id);
    const settings = await service.createSettings({ ...base, classId: 20, sectionId: 10, startDate: '2026-09-01', deadline: '14:00', firstReminderDelayMinutes: 0, subsequentReminderIntervals: [60, 120], lowAttendanceThreshold: 75 });
    assert.ok(settings.id);
    assert.strictEqual(db.state.audits.length, 4);
    await assert.rejects(
        service.createSchedule({ ...base, classId: 20, sectionId: 10, weekday: 8, startDate: '2026-09-01' }),
        /weekday/
    );
    await assert.rejects(
        service.createResponsibility({ ...base, classId: 20, sectionId: 10, staffId: 8, responsibilityType: 'secondary', startDate: '2026-09-01' }),
        /responsibility type/
    );
    await assert.rejects(
        service.createSettings({ ...base, classId: 20, sectionId: 10, startDate: '2026-09-01', deadline: '25:00', firstReminderDelayMinutes: 0, subsequentReminderIntervals: [], lowAttendanceThreshold: 75 }),
        /deadline/
    );
    await assert.rejects(
        service.createSchedule({ ...base, classId: 20, sectionId: 99, weekday: 1, startDate: '2026-09-01' }),
        /do not belong/
    );
    console.log('[attendance-setup-service] academic periods, schedules, teacher responsibilities, settings, validation and audit writes passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
