-- READ-ONLY preflight for 20261121_attendance_schedule_sets.sqlite.sql
-- Run against a verified copy of the intended database; this script performs no writes.

SELECT sqlite_version() AS sqlite_version;
SELECT name, type, sql
FROM sqlite_master
WHERE type IN ('table', 'index')
  AND name IN ('schools', 'sections', 'classes', 'staff',
               'class_attendance_schedules', 'attendance_registers',
               'attendance_register_students', 'attendance_register_events',
               'attendance_register_reminders', 'attendance_foundation_audit_logs')
ORDER BY type, name;

PRAGMA table_info(attendance_registers);
PRAGMA foreign_key_list(attendance_registers);
PRAGMA foreign_key_check;

SELECT
    (SELECT COUNT(*) FROM attendance_registers) AS register_rows,
    (SELECT COUNT(*) FROM class_attendance_schedules) AS legacy_schedule_rows,
    (SELECT COUNT(*) FROM attendance_registers WHERE schedule_id IS NULL) AS null_legacy_schedule_refs,
    (SELECT COUNT(*) FROM attendance_registers ar
      LEFT JOIN class_attendance_schedules s ON s.id = ar.schedule_id
      WHERE ar.schedule_id IS NOT NULL AND s.id IS NULL) AS orphan_legacy_schedule_refs;
