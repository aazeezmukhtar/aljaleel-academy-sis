-- READ-ONLY postflight for 20261121_attendance_schedule_sets.postgres.sql

SELECT to_regclass('public.attendance_schedule_sets') AS schedule_sets_table,
       to_regclass('public.attendance_schedule_days') AS schedule_days_table;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'attendance_registers'
  AND column_name IN ('schedule_id', 'schedule_set_id')
ORDER BY ordinal_position;

SELECT
    (SELECT COUNT(*) FROM attendance_schedule_sets) AS schedule_set_rows,
    (SELECT COUNT(*) FROM attendance_schedule_days) AS schedule_day_rows,
    (SELECT COUNT(*) FROM attendance_registers) AS register_rows,
    (SELECT COUNT(*) FROM attendance_registers WHERE schedule_id IS NOT NULL AND schedule_set_id IS NULL) AS legacy_registers,
    (SELECT COUNT(*) FROM attendance_registers WHERE schedule_id IS NULL AND schedule_set_id IS NOT NULL) AS schedule_set_registers,
    (SELECT COUNT(*) FROM attendance_registers WHERE
        (schedule_id IS NULL AND schedule_set_id IS NULL)
        OR (schedule_id IS NOT NULL AND schedule_set_id IS NOT NULL)) AS invalid_schedule_source_rows;

SELECT COUNT(*) AS orphan_schedule_set_references
FROM attendance_registers ar
LEFT JOIN attendance_schedule_sets ss ON ss.id = ar.schedule_set_id
WHERE ar.schedule_set_id IS NOT NULL AND ss.id IS NULL;

SELECT COUNT(*) AS orphan_legacy_schedule_references
FROM attendance_registers ar
LEFT JOIN class_attendance_schedules legacy ON legacy.id = ar.schedule_id
WHERE ar.schedule_id IS NOT NULL AND legacy.id IS NULL;

SELECT COUNT(*) AS invalid_weekday_rows
FROM attendance_schedule_days
WHERE weekday NOT BETWEEN 1 AND 7;
