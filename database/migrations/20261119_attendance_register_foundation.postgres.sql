-- AcadMe attendance register foundation (PostgreSQL 17+)
-- Additive, explicit/manual migration. It does not alter existing attendance rows.
-- Do not execute against production until preflight, verified backup, independent
-- restore test, disposable-database validation, and separate production approval.
--
-- Cross-table school/class/section/student ownership and effective-date overlap
-- are validated transactionally by application services in both database engines.

BEGIN;

CREATE TABLE IF NOT EXISTS section_academic_periods (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date),
    UNIQUE (section_id, session, term)
);

CREATE TABLE IF NOT EXISTS class_attendance_schedules (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE (class_id, section_id, weekday, effective_from)
);

CREATE TABLE IF NOT EXISTS class_attendance_responsibilities (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    responsibility_type TEXT NOT NULL
        CHECK (responsibility_type IN ('primary', 'secondary', 'substitute')),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE (class_id, section_id, staff_id, responsibility_type, effective_from)
);

CREATE TABLE IF NOT EXISTS class_attendance_settings (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    submission_deadline_time TIME NOT NULL,
    first_reminder_delay_minutes INTEGER NOT NULL DEFAULT 0
        CHECK (first_reminder_delay_minutes >= 0),
    subsequent_reminder_intervals_minutes JSONB NOT NULL
        CHECK (jsonb_typeof(subsequent_reminder_intervals_minutes) = 'array'),
    low_attendance_threshold NUMERIC(5,2) NOT NULL
        CHECK (low_attendance_threshold >= 0 AND low_attendance_threshold <= 100),
    created_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS class_attendance_closures (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('school', 'section', 'class')),
    section_id INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
    class_id INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_by INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    approved_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date),
    CHECK (
        (scope_type = 'school' AND section_id IS NULL AND class_id IS NULL)
        OR (scope_type = 'section' AND section_id IS NOT NULL AND class_id IS NULL)
        OR (scope_type = 'class' AND section_id IS NOT NULL AND class_id IS NOT NULL)
    ),
    CHECK (
        (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR status <> 'approved'
    )
);

CREATE TABLE IF NOT EXISTS attendance_registers (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    academic_period_id BIGINT NOT NULL REFERENCES section_academic_periods(id) ON DELETE RESTRICT,
    schedule_id BIGINT NOT NULL REFERENCES class_attendance_schedules(id) ON DELETE RESTRICT,
    responsibility_id BIGINT REFERENCES class_attendance_responsibilities(id) ON DELETE RESTRICT,
    register_date DATE NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
    submission_deadline_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'expected'
        CHECK (status IN ('expected', 'in_progress', 'submitted', 'reopened', 'closed')),
    expected_student_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_student_count >= 0),
    submitted_student_count INTEGER NOT NULL DEFAULT 0 CHECK (
        submitted_student_count >= 0 AND submitted_student_count <= expected_student_count
    ),
    first_submitted_at TIMESTAMPTZ,
    last_submitted_at TIMESTAMPTZ,
    submitted_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, section_id, register_date),
    CHECK (
        (status = 'submitted' AND first_submitted_at IS NOT NULL
            AND last_submitted_at IS NOT NULL AND submitted_by IS NOT NULL
            AND submitted_student_count = expected_student_count)
        OR status <> 'submitted'
    )
);

CREATE TABLE IF NOT EXISTS attendance_register_students (
    id BIGSERIAL PRIMARY KEY,
    register_id BIGINT NOT NULL REFERENCES attendance_registers(id) ON DELETE RESTRICT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    enrollment_period_id BIGINT NOT NULL REFERENCES student_enrollment_periods(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (register_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_register_events (
    id BIGSERIAL PRIMARY KEY,
    register_id BIGINT NOT NULL REFERENCES attendance_registers(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'generated', 'attendance_started', 'submitted', 'reopened',
        'resubmitted', 'administratively_closed', 'corrected', 'reminder_scheduled'
    )),
    actor_staff_id INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    previous_status TEXT,
    new_status TEXT,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_register_reminders (
    id BIGSERIAL PRIMARY KEY,
    register_id BIGINT NOT NULL REFERENCES attendance_registers(id) ON DELETE RESTRICT,
    recipient_staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    reminder_stage INTEGER NOT NULL CHECK (reminder_stage >= 1),
    reminder_type TEXT NOT NULL CHECK (reminder_type IN ('responsible_teacher', 'administrator_escalation')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'acknowledged', 'cancelled', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (register_id, recipient_staff_id, reminder_stage)
);

CREATE TABLE IF NOT EXISTS attendance_foundation_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    action TEXT NOT NULL,
    actor_staff_id INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    before_data JSONB,
    after_data JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_section_academic_periods_dates
    ON section_academic_periods (section_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_lookup
    ON class_attendance_schedules (class_id, section_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_attendance_responsibilities_lookup
    ON class_attendance_responsibilities (class_id, section_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_attendance_settings_lookup
    ON class_attendance_settings (class_id, section_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_attendance_closures_lookup
    ON class_attendance_closures (school_id, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_section_date
    ON attendance_registers (section_id, register_date, status);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_deadline
    ON attendance_registers (status, submission_deadline_at);
CREATE INDEX IF NOT EXISTS idx_attendance_register_students_student
    ON attendance_register_students (student_id, register_id);
CREATE INDEX IF NOT EXISTS idx_attendance_register_events_timeline
    ON attendance_register_events (register_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_attendance_register_reminders_due
    ON attendance_register_reminders (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_entity
    ON attendance_foundation_audit_logs (entity_type, entity_id, created_at, id);

COMMIT;
