'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'operations.ejs'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'attendanceController.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'attendanceRoutes.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'sidebar.ejs'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'attendanceOperationsService.js'), 'utf8');
ejs.compile(view);
assert.ok(view.includes('This page is read-only'));
assert.ok(view.includes('Scheduler run history'));
assert.ok(view.includes('Notification delivery queue'));
assert.ok(view.includes('Latest failed deliveries'));
assert.ok(view.includes('Possibly interrupted'));
assert.ok(view.includes('Missing means no register exists'));
assert.ok(view.includes('overdue means an existing register has passed its submission deadline without being submitted'));
assert.ok(routes.includes("router.get('/operations', attendanceController.getAttendanceOperations);"));
assert.ok(controller.includes("user.role !== 'Admin'"));
assert.ok(sidebar.includes('href="/attendance/operations"'));
assert.ok(!/\b(INSERT\s+INTO|UPDATE\s+attendance_|DELETE\s+FROM)\b/i.test(serviceSource), 'operations service must remain read-only');

const { createAttendanceOperationsService } = require('../services/attendanceOperationsService');

function makeDb(options = {}) {
    return {
        DB_TYPE: options.dbType || 'sqlite',
        async get(sql) {
            if (sql.includes('SELECT c.id, c.school_id, c.section_id FROM classes c')) {
                return { id: 4, school_id: 1, section_id: 2 };
            }
            if (sql.includes("name IN ('attendance_schedule_sets', 'attendance_schedule_days')")) return { table_count: 2 };
            if (sql.includes('sqlite_master')) {
                const tableName = arguments[1] && arguments[1][0];
                if (tableName === 'attendance_scheduler_runs') return options.schedulerTable === false ? undefined : { name: tableName };
                if (tableName === 'notification_deliveries') return options.deliveryTable === false ? undefined : { name: tableName };
                return undefined;
            }
            if (sql.includes('COUNT(*) AS total')) return { total: 8, queued: 3, due: 2, delivered: 2, read: 1, failed: 1, cancelled: 1, oldest_queued_at: '2026-11-20T10:00:00.000Z' };
            throw new Error('Unexpected get query: ' + sql);
        },
        async all(sql, params = []) {
            if (sql.includes('FROM attendance_schedule_sets ss')) {
                return params[2] === 'section'
                    ? [{ schedule_set_id: 55, scope_type: 'section', effective_from: '2026-11-01', effective_to: null, weekday: 5 }]
                    : [];
            }
            if (sql.includes('FROM classes c JOIN sections')) {
                return [{ class_id: 4, class_name: 'Primary 1', section_id: 2, section_name: 'Academy' }];
            }
            if (sql.includes('FROM section_academic_periods')) {
                return [{ id: 1, section_id: 2, session: '2026/2027', term: 'First Term', start_date: '2026-11-01', end_date: '2026-11-30' }];
            }
            if (sql.includes('FROM class_attendance_closures')) return [];
            if (sql.includes('FROM attendance_registers ar')) {
                return [{
                    id: 22, class_id: 4, section_id: 2, register_date: '2026-11-13',
                    status: 'in_progress', submission_deadline_at: '2026-11-13T12:00:00.000Z',
                    responsibility_id: 3, teacher_first_name: 'Amina', teacher_last_name: 'Bello'
                }];
            }
            if (sql.includes('FROM attendance_register_reminders r')) {
                return [{
                    id: 31, register_id: 22, recipient_staff_id: 8, reminder_stage: 1,
                    reminder_type: 'responsible_teacher', scheduled_at: '2026-11-13T13:00:00.000Z',
                    sent_at: '2026-11-13T13:01:00.000Z', acknowledged_at: null,
                    status: 'sent', attempt_count: 1, last_error: null,
                    first_name: 'Amina', last_name: 'Bello'
                }];
            }
            if (sql.includes('FROM notification_deliveries')) {
                return [{ id: 77, category: 'attendance', source_type: 'attendance_register_reminder', title: 'Register reminder', last_error: 'Temporary dispatch issue', attempt_count: 2, updated_at: '2026-11-20T12:00:00.000Z' }];
            }
            if (sql.includes('FROM attendance_scheduler_runs')) {
                return [
                    {
                        id: 11, started_at: '2026-11-20T12:00:00.000Z',
                        completed_at: null, status: 'running', summary: null,
                        error_message: null
                    },
                    {
                        id: 10, started_at: '2026-11-20T11:00:00.000Z',
                        completed_at: '2026-11-20T11:00:03.000Z', status: 'failed',
                        summary: null, error_message: 'Test scheduler failure'
                    },
                    {
                        id: 9, started_at: '2026-11-20T10:00:00.000Z',
                        completed_at: '2026-11-20T10:00:08.000Z', status: 'succeeded',
                        summary: JSON.stringify({ generatedRegisterCount: 2, scheduledCount: 3 }),
                        error_message: null
                    }
                ];
            }
            throw new Error('Unexpected query: ' + sql);
        }
    };
}

(async () => {
    const now = '2026-11-20T23:30:00.000Z';
    const service = createAttendanceOperationsService(makeDb());
    const result = await service.getOperations({ schoolId: 1, now });
    assert.strictEqual(result.startDate, '2026-11-08');
    assert.strictEqual(result.endDate, '2026-11-21');
    assert.strictEqual(result.summary.expected, 2);
    assert.strictEqual(result.summary.incomplete, 1);
    assert.strictEqual(result.summary.missing, 1);
    assert.strictEqual(result.summary.overdue, 1);
    assert.strictEqual(result.summary.reminders, 1);
    const overdue = result.rows.find(row => row.date === '2026-11-13');
    assert.strictEqual(overdue.responsibleTeacher, 'Amina Bello');
    assert.strictEqual(overdue.reminders[0].recipient, 'Amina Bello');
    assert.strictEqual(overdue.reminders[0].status, 'sent');
    const missing = result.rows.find(row => row.date === '2026-11-20');
    assert.strictEqual(missing.status, 'missing');
    assert.strictEqual(missing.registerId, null);
    assert.strictEqual(result.schedulerHistory.available, true);
    assert.strictEqual(result.notificationDeliveryHealth.available, true);
    assert.strictEqual(result.notificationDeliveryHealth.summary.total, 8);
    assert.strictEqual(result.notificationDeliveryHealth.summary.due, 2);
    assert.strictEqual(result.notificationDeliveryHealth.summary.failed, 1);
    assert.strictEqual(result.notificationDeliveryHealth.summary.oldestQueuedAgeMinutes, 810);
    assert.strictEqual(result.notificationDeliveryHealth.recentFailures[0].error, 'Temporary dispatch issue');
    assert.strictEqual(result.schedulerHistory.summary.succeeded, 1);
    assert.strictEqual(result.schedulerHistory.latest.status, 'running');
    const successfulRun = result.schedulerHistory.runs.find(run => run.status === 'succeeded');
    assert.strictEqual(successfulRun.summary.scheduledCount, 3);

    const noMigration = await createAttendanceOperationsService(makeDb({ schedulerTable: false, deliveryTable: false }))
        .getOperations({ schoolId: 1, now });
    assert.strictEqual(noMigration.schedulerHistory.available, false);
    assert.strictEqual(noMigration.schedulerHistory.runs.length, 0);
    assert.strictEqual(noMigration.notificationDeliveryHealth.available, false);

    const postgresDb = makeDb({ dbType: 'postgres' });
    postgresDb.get = async (sql, params = []) => {
        if (sql.includes('SELECT c.id, c.school_id, c.section_id FROM classes c')) {
            return { id: 4, school_id: 1, section_id: 2 };
        }
        if (sql.includes("to_regclass('attendance_schedule_sets')")) {
            return { sets_name: 'attendance_schedule_sets', days_name: 'attendance_schedule_days' };
        }
        if (sql.includes('to_regclass')) {
            const tableName = params[0];
            return { table_name: tableName === 'public.attendance_scheduler_runs' ? 'attendance_scheduler_runs' : 'notification_deliveries' };
        }
        if (sql.includes('COUNT(*) AS total')) {
            return { total: 8, queued: 3, due: 2, delivered: 2, read: 1, failed: 1, cancelled: 1, oldest_queued_at: '2026-11-20T10:00:00.000Z' };
        }
        throw new Error('Unexpected PostgreSQL get query: ' + sql);
    };
    const postgresHistory = await createAttendanceOperationsService(postgresDb)
        .getOperations({ schoolId: 1, now });
    assert.strictEqual(postgresHistory.schedulerHistory.available, true);
    assert.strictEqual(postgresHistory.notificationDeliveryHealth.available, true);
    assert.strictEqual(postgresHistory.notificationDeliveryHealth.summary.queued, 3);
    assert.strictEqual(postgresHistory.schedulerHistory.latest.status, 'running');
    assert.strictEqual(postgresHistory.schedulerHistory.runs.find(run => run.status === 'succeeded').summary.scheduledCount, 3);

    console.log('Attendance operations service tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
