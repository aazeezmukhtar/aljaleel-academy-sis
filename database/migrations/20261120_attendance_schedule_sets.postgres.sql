-- AcadMe section-level attendance schedule defaults and class overrides.
-- Phase A: additive PostgreSQL migration. Explicit/manual only.
-- Preserves legacy class_attendance_schedules rows and existing register references.
-- Do not execute in production until separately approved after read-only preflight.

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_schedule_sets (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    class_id INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('section', 'class')),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CHECK (
        (scope_type = 'section' AND class_id IS NULL)
        OR (scope_type = 'class' AND class_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS attendance_schedule_days (
    id BIGSERIAL PRIMARY KEY,
    schedule_set_id BIGINT NOT NULL
        REFERENCES attendance_schedule_sets(id) ON DELETE RESTRICT,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
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

ALTER TABLE attendance_registers
    ALTER COLUMN schedule_id DROP NOT NULL;

ALTER TABLE attendance_registers
    ADD COLUMN IF NOT EXISTS schedule_set_id BIGINT
        REFERENCES attendance_schedule_sets(id) ON DELETE RESTRICT;

ALTER TABLE attendance_registers
    DROP CONSTRAINT IF EXISTS attendance_registers_exactly_one_schedule_check;

ALTER TABLE attendance_registers
    ADD CONSTRAINT attendance_registers_exactly_one_schedule_check
    CHECK (
        (schedule_id IS NOT NULL AND schedule_set_id IS NULL)
        OR (schedule_id IS NULL AND schedule_set_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_attendance_registers_schedule_set
    ON attendance_registers (schedule_set_id)
    WHERE schedule_set_id IS NOT NULL;

COMMIT;
