-- AcadMe formal attendance register submission (PostgreSQL)
-- Manual, additive migration only. Never run automatically or against production without approval.
BEGIN;
CREATE TABLE IF NOT EXISTS attendance_registers (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  section_id BIGINT NOT NULL REFERENCES sections(id),
  class_id BIGINT NOT NULL REFERENCES classes(id),
  attendance_date DATE NOT NULL,
  session TEXT NOT NULL,
  term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted')),
  submission_version INTEGER NOT NULL DEFAULT 0 CHECK(submission_version >= 0),
  submitted_at TIMESTAMPTZ,
  submitted_by BIGINT REFERENCES staff(id),
  reopened_at TIMESTAMPTZ,
  reopened_by BIGINT REFERENCES staff(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_register_context_unique UNIQUE(school_id,class_id,section_id,attendance_date,session,term)
);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_lookup
  ON attendance_registers(school_id,section_id,attendance_date,status);
CREATE TABLE IF NOT EXISTS attendance_register_events (
  id BIGSERIAL PRIMARY KEY,
  register_id BIGINT NOT NULL REFERENCES attendance_registers(id),
  school_id BIGINT NOT NULL REFERENCES schools(id),
  action TEXT NOT NULL CHECK(action IN ('submitted','reopened')),
  version INTEGER NOT NULL CHECK(version > 0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  actor_id BIGINT NOT NULL REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_register_events_history
  ON attendance_register_events(school_id,register_id,created_at,id);
CREATE OR REPLACE FUNCTION prevent_attendance_register_event_mutation()
RETURNS TRIGGER AS $$ BEGIN
  RAISE EXCEPTION 'Attendance register events are immutable';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_attendance_register_events_immutable ON attendance_register_events;
CREATE TRIGGER trg_attendance_register_events_immutable
BEFORE UPDATE OR DELETE ON attendance_register_events
FOR EACH ROW EXECUTE FUNCTION prevent_attendance_register_event_mutation();
COMMIT;
