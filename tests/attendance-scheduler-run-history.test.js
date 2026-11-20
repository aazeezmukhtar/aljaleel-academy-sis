'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createAttendanceSchedulerRunRecorder } =
    require('../services/attendanceSchedulerRunHistoryService');

(async () => {
    const sqlite = new Database(':memory:');
    try {
        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'database', 'migrations', '20261120_attendance_scheduler_runs.sqlite.sql'),
            'utf8'
        );
        sqlite.exec(migration);
        const db = {
            get: async (sql, params = []) => sqlite.prepare(sql).get(params),
            run: async (sql, params = []) => {
                const result = sqlite.prepare(sql).run(params);
                return { changes: result.changes };
            }
        };

        const successRunner = createAttendanceSchedulerRunRecorder(db, async () => ({
            processedCount: 4, scheduledCount: 2, generatedRegisterCount: 1
        }));
        const success = await successRunner({ now: '2026-11-20T10:00:00.000Z' });
        assert.strictEqual(success.schedulerRunId, 1);
        const successRow = sqlite.prepare('SELECT * FROM attendance_scheduler_runs WHERE id = 1').get();
        assert.strictEqual(successRow.status, 'succeeded');
        assert(successRow.completed_at);
        assert.deepStrictEqual(JSON.parse(successRow.summary), {
            processedCount: 4, scheduledCount: 2, generatedRegisterCount: 1
        });
        assert.strictEqual(successRow.error_message, null);

        const failureRunner = createAttendanceSchedulerRunRecorder(db, async () => {
            throw new Error('simulated scheduler failure');
        });
        await assert.rejects(() => failureRunner({ now: '2026-11-20T11:00:00.000Z' }), /simulated scheduler failure/);
        const failedRow = sqlite.prepare('SELECT * FROM attendance_scheduler_runs WHERE id = 2').get();
        assert.strictEqual(failedRow.status, 'failed');
        assert(failedRow.completed_at);
        assert.strictEqual(failedRow.error_message, 'simulated scheduler failure');
        assert.strictEqual(failedRow.summary, null);

        assert.throws(() => sqlite.prepare(`
            INSERT INTO attendance_scheduler_runs (status, completed_at)
            VALUES ('failed', NULL)
        ` ).run(), /CHECK constraint failed/);

        console.log('[attendance-scheduler-run-history] successful and failed runs are durably recorded.');
    } finally {
        sqlite.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
