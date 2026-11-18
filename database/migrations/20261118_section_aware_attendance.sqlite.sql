-- AcadMe section-aware attendance foundation (SQLite)
-- Explicit/manual migration. Back up the database and test a copy first.
-- Preserves attendance IDs, statuses, reasons, dates, sessions, terms and arm_id.

PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE attendance_section_aware_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER REFERENCES students(id),
    class_id INTEGER REFERENCES classes(id),
    section_id INTEGER NOT NULL REFERENCES sections(id),
    arm_id INTEGER REFERENCES arms(id),
    status TEXT NOT NULL CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')),
    date DATE NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    reason TEXT,
    reason_type TEXT,
    custom_reason TEXT
);

INSERT INTO attendance_section_aware_new
    (id, student_id, class_id, section_id, arm_id, status, date, session, term, reason, reason_type, custom_reason)
SELECT
    a.id, a.student_id, a.class_id, c.section_id, a.arm_id, a.status, a.date, a.session, a.term,
    a.reason, a.reason_type, a.custom_reason
FROM attendance a
JOIN classes c ON c.id = a.class_id
WHERE c.section_id IS NOT NULL;

-- Abort if any original row could not be carried into the new table.
CREATE TEMP TABLE attendance_migration_guard (ok INTEGER NOT NULL CHECK(ok = 1));
INSERT INTO attendance_migration_guard(ok)
SELECT CASE WHEN
    (SELECT COUNT(*) FROM attendance) =
    (SELECT COUNT(*) FROM attendance_section_aware_new)
THEN 1 ELSE 0 END;

DROP TABLE attendance;
ALTER TABLE attendance_section_aware_new RENAME TO attendance;

CREATE UNIQUE INDEX attendance_student_section_date_session_term_key
    ON attendance(student_id, section_id, date, session, term);
CREATE INDEX IF NOT EXISTS idx_attendance_lookup ON attendance(class_id, arm_id, date);
CREATE INDEX idx_attendance_section_date ON attendance(section_id, date);

DROP TABLE attendance_migration_guard;
COMMIT;
PRAGMA foreign_keys = ON;
