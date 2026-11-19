-- AcadMe missing attendance register reminders (PostgreSQL)
-- Manual additive migration. Never run automatically at application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS attendance_register_reminders (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  section_id BIGINT NOT NULL REFERENCES sections(id),
  class_id BIGINT NOT NULL REFERENCES classes(id),
  staff_id BIGINT NOT NULL REFERENCES staff(id),
  attendance_date DATE NOT NULL,
  session TEXT NOT NULL,
  term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT attendance_register_reminders_context_unique
    UNIQUE (school_id, section_id, class_id, attendance_date, session, term)
);
CREATE INDEX IF NOT EXISTS idx_attendance_register_reminders_staff
  ON attendance_register_reminders(school_id, staff_id, status, attendance_date);
COMMIT;
