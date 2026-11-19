-- AcadMe formal attendance register submission (SQLite)
-- Manual, additive migration only. Never run automatically or against production without approval.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS attendance_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  section_id INTEGER NOT NULL REFERENCES sections(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  attendance_date DATE NOT NULL,
  session TEXT NOT NULL,
  term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted')),
  submission_version INTEGER NOT NULL DEFAULT 0 CHECK(submission_version >= 0),
  submitted_at TEXT,
  submitted_by INTEGER REFERENCES staff(id),
  reopened_at TEXT,
  reopened_by INTEGER REFERENCES staff(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, class_id, section_id, attendance_date, session, term)
);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_lookup
  ON attendance_registers(school_id, section_id, attendance_date, status);
CREATE TABLE IF NOT EXISTS attendance_register_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  register_id INTEGER NOT NULL REFERENCES attendance_registers(id),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  action TEXT NOT NULL CHECK(action IN ('submitted','reopened')),
  version INTEGER NOT NULL CHECK(version > 0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  old_values TEXT,
  new_values TEXT,
  actor_id INTEGER NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_register_events_history
  ON attendance_register_events(school_id, register_id, created_at, id);
CREATE TRIGGER IF NOT EXISTS trg_attendance_register_events_no_update
BEFORE UPDATE ON attendance_register_events BEGIN
  SELECT RAISE(ABORT, 'Attendance register events are immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_attendance_register_events_no_delete
BEFORE DELETE ON attendance_register_events BEGIN
  SELECT RAISE(ABORT, 'Attendance register events are immutable');
END;
COMMIT;
