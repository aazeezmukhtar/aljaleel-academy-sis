-- AcadMe section-level attendance schedule defaults and class overrides (SQLite).
-- Additive, explicit/manual migration. Preserve existing register history and legacy schedules.
-- Run only after the attendance register foundation migration.
-- PRAGMA foreign_keys must be restored ON by this script after the table rebuild.

PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS attendance_schedule_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    class_id INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('section', 'class')),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CHECK (
        (scope_type = 'section' AND class_id IS NULL)
        OR (scope_type = 'class' AND class_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS attendance_schedule_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_set_id INTEGER NOT NULL REFERENCES attendance_schedule_sets(id) ON DELETE RESTRICT,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    UNIQUE (schedule_set_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_attendance_schedule_sets_section_dates
    ON attendance_schedule_sets (school_id, section_id, effective_from, effective_to)
    WHERE scope_type = 'section';

CREATE INDEX IF NOT EXISTS idx_attendance_schedule_sets_class_dates
    ON attendance_schedule_sets (school_id, section_id, class_id, effective_from, effective_to)
    WHERE scope_type = 'class';

CREATE INDEX IF NOT EXISTS idx_attendance_schedule_days_set_weekday
    ON attendance_schedule_days (schedule_set_id, weekday);

CREATE TABLE attendance_registers_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    academic_period_id INTEGER NOT NULL REFERENCES section_academic_periods(id) ON DELETE RESTRICT,
    schedule_id INTEGER REFERENCES class_attendance_schedules(id) ON DELETE RESTRICT,
    schedule_set_id INTEGER REFERENCES attendance_schedule_sets(id) ON DELETE RESTRICT,
    responsibility_id INTEGER REFERENCES class_attendance_responsibilities(id) ON DELETE RESTRICT,
    register_date DATE NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
    submission_deadline_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'expected'
        CHECK (status IN ('expected', 'in_progress', 'submitted', 'reopened', 'closed')),
    expected_student_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_student_count >= 0),
    submitted_student_count INTEGER NOT NULL DEFAULT 0
        CHECK (submitted_student_count >= 0 AND submitted_student_count <= expected_student_count),
    first_submitted_at TEXT,
    last_submitted_at TEXT,
    submitted_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, section_id, register_date),
    CHECK (
        (schedule_id IS NOT NULL AND schedule_set_id IS NULL)
        OR (schedule_id IS NULL AND schedule_set_id IS NOT NULL)
    ),
    CHECK (
        (status = 'submitted' AND first_submitted_at IS NOT NULL
            AND last_submitted_at IS NOT NULL AND submitted_by IS NOT NULL
            AND submitted_student_count = expected_student_count)
        OR status <> 'submitted'
    )
);

INSERT INTO attendance_registers_new (
    id, school_id, class_id, section_id, academic_period_id, schedule_id,
    schedule_set_id, responsibility_id, register_date, timezone,
    submission_deadline_at, status, expected_student_count, submitted_student_count,
    first_submitted_at, last_submitted_at, submitted_by, created_at, updated_at
)
SELECT
    id, school_id, class_id, section_id, academic_period_id, schedule_id,
    NULL, responsibility_id, register_date, timezone,
    submission_deadline_at, status, expected_student_count, submitted_student_count,
    first_submitted_at, last_submitted_at, submitted_by, created_at, updated_at
FROM attendance_registers;

DROP TABLE attendance_registers;
ALTER TABLE attendance_registers_new RENAME TO attendance_registers;

CREATE INDEX IF NOT EXISTS idx_attendance_registers_schedule_set
    ON attendance_registers (schedule_set_id)
    WHERE schedule_set_id IS NOT NULL;

COMMIT;
PRAGMA foreign_keys = ON;
