'use strict';

function createAttendanceSchedulerRunRecorder(db, scheduleFn) {
    if (!db || typeof db.get !== 'function' || typeof db.run !== 'function') {
        throw new Error('A scheduler run history database adapter is required.');
    }
    if (typeof scheduleFn !== 'function') {
        throw new Error('A scheduler function is required.');
    }

    return async function runScheduler(input = {}) {
        const startedAt = new Date(input.now || new Date()).toISOString();
        const inserted = await db.get(
            `INSERT INTO attendance_scheduler_runs (started_at, status)
             VALUES (?, 'running') RETURNING id`,
            [startedAt]
        );
        if (!inserted || inserted.id == null) {
            throw new Error('The scheduler run history record could not be created.');
        }

        try {
            const summary = await scheduleFn(input);
            const completedAt = new Date().toISOString();
            await db.run(
                `UPDATE attendance_scheduler_runs
                 SET status = 'succeeded', completed_at = ?, summary = ?, error_message = NULL
                 WHERE id = ? AND status = 'running'`,
                [completedAt, JSON.stringify(summary || {}), inserted.id]
            );
            return { ...summary, schedulerRunId: inserted.id };
        } catch (error) {
            const completedAt = new Date().toISOString();
            const message = String(error && error.message || 'Unknown scheduler error').slice(0, 2000);
            try {
                await db.run(
                    `UPDATE attendance_scheduler_runs
                     SET status = 'failed', completed_at = ?, error_message = ?
                     WHERE id = ? AND status = 'running'`,
                    [completedAt, message, inserted.id]
                );
            } catch (historyError) {
                console.error('[attendance-reminder-scheduler] Could not persist failed run:', historyError);
            }
            throw error;
        }
    };
}

module.exports = { createAttendanceSchedulerRunRecorder };
