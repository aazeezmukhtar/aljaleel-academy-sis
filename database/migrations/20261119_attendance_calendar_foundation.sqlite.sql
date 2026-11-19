-- AcadMe attendance calendar foundation (SQLite)
-- Explicit/manual additive migration. Never run from application startup.
-- No legacy schedules, term dates, closures, or teacher assignments are inferred.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS section_academic_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  section_id INTEGER NOT NULL REFERENCES sections(id),
  session TEXT NOT NULL,
  term TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date),
  UNIQUE (school_id, section_id, session, term)
);
CREATE INDEX IF NOT EXISTS idx_section_academic_periods_dates
  ON section_academic_periods(school_id, section_id, session, start_date, end_date);

CREATE TABLE IF NOT EXISTS class_attendance_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  session TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  monday INTEGER NOT NULL DEFAULT 0 CHECK (monday IN (0,1)),
  tuesday INTEGER NOT NULL DEFAULT 0 CHECK (tuesday IN (0,1)),
  wednesday INTEGER NOT NULL DEFAULT 0 CHECK (wednesday IN (0,1)),
  thursday INTEGER NOT NULL DEFAULT 0 CHECK (thursday IN (0,1)),
  friday INTEGER NOT NULL DEFAULT 0 CHECK (friday IN (0,1)),
  saturday INTEGER NOT NULL DEFAULT 0 CHECK (saturday IN (0,1)),
  sunday INTEGER NOT NULL DEFAULT 0 CHECK (sunday IN (0,1)),
  created_by INTEGER NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (monday + tuesday + wednesday + thursday + friday + saturday + sunday >= 1)
);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_timeline
  ON class_attendance_schedules(school_id, class_id, session, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS class_attendance_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('school','section','class')),
  section_id INTEGER REFERENCES sections(id),
  class_id INTEGER REFERENCES classes(id),
  closure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  source_event_id INTEGER REFERENCES term_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by INTEGER NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  session TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by INTEGER NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_attendance_responsibilities_timeline
  ON class_attendance_responsibilities(school_id, class_id, session, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS attendance_foundation_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'academic_period','attendance_schedule','attendance_closure','attendance_responsibility'
  )),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','corrected','closed','cancelled')),
  old_values TEXT,
  new_values TEXT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  changed_by INTEGER NOT NULL REFERENCES staff(id),
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_foundation_audit_entity
  ON attendance_foundation_audit_logs(school_id, entity_type, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_attendance_foundation_audit_actor
  ON attendance_foundation_audit_logs(school_id, changed_by, changed_at);

CREATE TRIGGER IF NOT EXISTS trg_attendance_foundation_audit_no_update
BEFORE UPDATE ON attendance_foundation_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Attendance foundation audit logs are immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_attendance_foundation_audit_no_delete
BEFORE DELETE ON attendance_foundation_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Attendance foundation audit logs are immutable');
END;

COMMIT;
