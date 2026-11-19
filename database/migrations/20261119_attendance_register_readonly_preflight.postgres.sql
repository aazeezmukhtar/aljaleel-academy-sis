-- READ-ONLY production preflight for the AcadMe attendance-register foundation.
-- Run in Supabase SQL Editor against the intended production project.
-- This script does not create, alter, update, delete, or lock application tables.
-- Keep the complete result sets for review. Do not run any migration in this step.

BEGIN TRANSACTION READ ONLY;

-- 1. Confirm the expected tables exist and expose the exact referenced key types.
SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
      (c.table_name IN (
          'schools', 'sections', 'staff', 'students', 'classes',
          'student_enrollment_history', 'student_enrollment_periods',
          'attendance'
      ) AND c.column_name IN (
          'id', 'school_id', 'section_id', 'student_id', 'class_id',
          'start_event_id', 'end_event_id', 'session', 'start_date',
          'end_date', 'date_status', 'status', 'date', 'term'
      ))
  )
ORDER BY c.table_name, c.ordinal_position;

-- 2. Primary-key and foreign-key definitions for the tables referenced by
-- the proposed foundation. This reveals actual FK target columns and types.
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_name = tc.table_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_schema = tc.constraint_schema
 AND ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN (
      'schools', 'sections', 'staff', 'students', 'classes',
      'student_enrollment_history', 'student_enrollment_periods',
      'attendance'
  )
  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- 3. Verify whether any of the ten proposed table names already exist.
-- Expected result before migration: all ten rows report ABSENT.
WITH expected(table_name) AS (
    VALUES
      ('section_academic_periods'),
      ('class_attendance_schedules'),
      ('class_attendance_responsibilities'),
      ('class_attendance_settings'),
      ('class_attendance_closures'),
      ('attendance_registers'),
      ('attendance_register_students'),
      ('attendance_register_events'),
      ('attendance_register_reminders'),
      ('attendance_foundation_audit_logs')
)
SELECT
    e.table_name,
    CASE WHEN t.table_name IS NULL THEN 'ABSENT' ELSE 'PRESENT' END AS table_status
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = e.table_name
 AND t.table_type = 'BASE TABLE'
ORDER BY e.table_name;

-- 4. Existing attendance baseline: preserve this count/status distribution.
SELECT status, COUNT(*) AS row_count
FROM public.attendance
GROUP BY status
ORDER BY status;

SELECT
    COUNT(*) AS total_attendance_rows,
    COUNT(*) FILTER (WHERE student_id IS NULL) AS null_student_ids,
    COUNT(*) FILTER (WHERE class_id IS NULL) AS null_class_ids,
    COUNT(*) FILTER (WHERE section_id IS NULL) AS null_section_ids
FROM public.attendance;

-- 5. Confirm the dated enrollment-period table is available and inspect
-- its current data-quality baseline without changing it.
SELECT
    COUNT(*) AS total_periods,
    COUNT(*) FILTER (WHERE end_date IS NULL) AS open_periods,
    COUNT(*) FILTER (WHERE date_status = 'confirmed') AS confirmed_periods,
    COUNT(*) FILTER (WHERE date_status = 'review_needed') AS review_needed_periods,
    COUNT(*) FILTER (WHERE end_date IS NOT NULL AND end_date < start_date) AS invalid_ranges
FROM public.student_enrollment_periods;

ROLLBACK;
