-- READ-ONLY preflight for 20261121_attendance_schedule_sets.postgres.sql
-- Run against the intended database; this script performs no writes.

SELECT current_database() AS database_name, current_user AS database_user,
       current_setting('server_version') AS postgres_version;

SELECT required.table_name, to_regclass('public.' || required.table_name) AS resolved_table
FROM (VALUES
    ('schools'), ('sections'), ('classes'), ('staff'),
    ('class_attendance_schedules'), ('attendance_registers'),
    ('attendance_register_students'), ('attendance_register_events'),
    ('attendance_register_reminders'), ('attendance_foundation_audit_logs')
) AS required(table_name);

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('attendance_registers', 'class_attendance_schedules')
  AND column_name IN ('id', 'school_id', 'class_id', 'section_id', 'schedule_id',
                      'register_date', 'effective_from', 'effective_to')
ORDER BY table_name, ordinal_position;

SELECT
    (SELECT COUNT(*) FROM public.attendance_registers) AS register_rows,
    (SELECT COUNT(*) FROM public.class_attendance_schedules) AS legacy_schedule_rows,
    (SELECT COUNT(*) FROM public.attendance_registers WHERE schedule_id IS NULL) AS null_legacy_schedule_refs,
    (SELECT COUNT(*) FROM public.attendance_registers ar
      LEFT JOIN public.class_attendance_schedules s ON s.id = ar.schedule_id
      WHERE ar.schedule_id IS NOT NULL AND s.id IS NULL) AS orphan_legacy_schedule_refs;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.attendance_registers'::regclass,
                   'public.class_attendance_schedules'::regclass)
ORDER BY table_name::text, conname;
