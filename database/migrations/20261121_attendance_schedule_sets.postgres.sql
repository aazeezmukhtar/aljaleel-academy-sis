-- AcadMe section defaults and class schedule overrides (PostgreSQL 17+)
-- Explicit/manual additive migration. Never run automatically at application startup.
-- Does not seed schedules or academic periods and does not alter the legacy attendance table.
-- Production execution requires a separate read-only preflight, verified recovery plan,
-- disposable PostgreSQL validation, and explicit approval.

BEGIN;

CREATE TABLE attendance_schedule_sets (
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

CREATE TABLE attendance_schedule_days (
    id BIGSERIAL PRIMARY KEY,
    schedule_set_id BIGINT NOT NULL
        REFERENCES attendance_schedule_sets(id) ON DELETE RESTRICT,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    UNIQUE (schedule_set_id, weekday)
);

CREATE INDEX idx_attendance_schedule_sets_resolve
    ON attendance_schedule_sets
       (school_id, section_id, scope_type, class_id, effective_from, effective_to);
CREATE INDEX idx_attendance_schedule_days_lookup
    ON attendance_schedule_days (schedule_set_id, weekday);

ALTER TABLE attendance_registers
    ALTER COLUMN schedule_id DROP NOT NULL;

ALTER TABLE attendance_registers
    ADD COLUMN schedule_set_id BIGINT
        REFERENCES attendance_schedule_sets(id) ON DELETE RESTRICT;

ALTER TABLE attendance_registers
    ADD CONSTRAINT attendance_registers_schedule_source_check
    CHECK (
        (schedule_id IS NOT NULL AND schedule_set_id IS NULL)
        OR (schedule_id IS NULL AND schedule_set_id IS NOT NULL)
    );

CREATE INDEX idx_attendance_registers_schedule_set
    ON attendance_registers (schedule_set_id)
    WHERE schedule_set_id IS NOT NULL;

COMMIT;
