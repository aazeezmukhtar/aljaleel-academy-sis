-- Attendance scheduler execution history (SQLite)
-- Additive migration: records scheduler outcomes; does not modify attendance data.

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_scheduler_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'succeeded', 'failed')),
    summary TEXT,
    error_message TEXT,
    CHECK (
        (status = 'running' AND completed_at IS NULL)
        OR (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL)
    ),
    CHECK (
        (status = 'failed' AND error_message IS NOT NULL)
        OR status <> 'failed'
    )
);

CREATE INDEX IF NOT EXISTS idx_attendance_scheduler_runs_history
    ON attendance_scheduler_runs (started_at DESC, id DESC);

COMMIT;
