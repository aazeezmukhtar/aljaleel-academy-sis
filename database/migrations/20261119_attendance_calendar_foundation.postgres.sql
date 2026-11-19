-- AcadMe attendance calendar foundation (PostgreSQL)
-- Explicit/manual additive migration. Never run from application startup.
-- No legacy schedules, term dates, closures, or teacher assignments are inferred.

BEGIN;

CREATE TABLE IF NOT EXISTS section_academic_periods (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  section_id BIGINT NOT NULL REFERENCES sections(id),
  session TEXT NOT NULL,
  term TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT section_academic_periods_dates_check CHECK (end_date >= start_date),
  CONSTRAINT section_academic_periods_term_unique UNIQUE (school_id, section_id, session, term)
);
CREATE INDEX IF NOT EXISTS idx_section_academic_periods_dates
  ON section_academic_periods(school_id, section_id, session, start_date, end_date);

CREATE TABLE IF NOT EXISTS class_attendance_schedules (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  class_id BIGINT NOT NULL REFERENCES classes(id),
  session TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  monday BOOLEAN NOT NULL DEFAULT FALSE,
  tuesday BOOLEAN NOT NULL DEFAULT FALSE,
  wednesday BOOLEAN NOT NULL DEFAULT FALSE,
  thursday BOOLEAN NOT NULL DEFAULT FALSE,
  friday BOOLEAN NOT NULL DEFAULT FALSE,
  saturday BOOLEAN NOT NULL DEFAULT FALSE,
  sunday BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT NOT NULL REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_schedule_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT attendance_schedule_weekdays_check CHECK (
    monday OR tuesday OR wednesday OR thursday OR friday OR saturday OR sunday
  )
);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_timeline
  ON class_attendance_schedules(school_id, class_id, session, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS class_attendance_closures (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('school','section','class')),
  section_id BIGINT REFERENCES sections(id),
  class_id BIGINT REFERENCES classes(id),
  closure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  source_event_id BIGINT REFERENCES term_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by BIGINT NOT NULL REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_closure_scope_check CHECK (
    (scope_type = 'school' AND section_id IS NULL AND class_id IS NULL) OR
    (scope_type = 'section' AND section_id IS NOT NULL AND class_id IS NULL) OR
    (scope_type = 'class' AND section_id IS NULL AND class_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_closure_school_active
  ON class_attendance_closures(school_id, closure_date)
  WHERE scope_type = 'school' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_closure_section_active
  ON class_attendance_closures(school_id, section_id, closure_date)
  WHERE scope_type = 'section' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_closure_class_active
  ON class_attendance_closures(school_id, class_id, closure_date)
  WHERE scope_type = 'class' AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_attendance_closures_date
  ON class_attendance_closures(school_id, closure_date, status);

CREATE TABLE IF NOT EXISTS class_attendance_responsibilities (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  class_id BIGINT NOT NULL REFERENCES classes(id),
  staff_id BIGINT NOT NULL REFERENCES staff(id),
  session TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by BIGINT NOT NULL REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_responsibility_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_attendance_responsibilities_timeline
  ON class_attendance_responsibilities(school_id, class_id, session, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS attendance_foundation_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'academic_period','attendance_schedule','attendance_closure','attendance_responsibility'
  )),
  entity_id BIGINT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','corrected','closed','cancelled')),
  old_values JSONB,
  new_values JSONB,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  changed_by BIGINT NOT NULL REFERENCES staff(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_foundation_audit_entity
  ON attendance_foundation_audit_logs(school_id, entity_type, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_attendance_foundation_audit_actor
  ON attendance_foundation_audit_logs(school_id, changed_by, changed_at);

CREATE OR REPLACE FUNCTION prevent_attendance_foundation_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance foundation audit logs are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_foundation_audit_immutable ON attendance_foundation_audit_logs;
CREATE TRIGGER trg_attendance_foundation_audit_immutable
BEFORE UPDATE OR DELETE ON attendance_foundation_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_attendance_foundation_audit_mutation();

COMMIT;
