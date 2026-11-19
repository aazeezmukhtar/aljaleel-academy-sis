# AcadMe attendance foundation rollout and verification

## Current status

This document describes the proposed manual rollout order. It is not authorization to run migrations. No production migration, data change, merge, or deployment is approved by this document.

The Phase 7 feature branch requires the dated enrollment history foundation for register-date rosters. Missing or review-needed historical dates are never inferred.

## Exact migration order

Choose one database engine and execute only its matching SQL file for each step. The attendance rollout comprises five foundation migrations, plus the prerequisite history migration when it is not already correctly installed.

0. **Prerequisite: student enrollment history**
   - `20261105_student_enrollment_history.sqlite.sql` or `20261105_student_enrollment_history.postgres.sql`
   - Required by the dated placement-period migration. It imports legacy baseline provenance with unknown dates left NULL; it does not invent commencement dates.
   - If PostgreSQL already has this table from the earlier migration version, inspect its source-enrollment foreign key. If present, apply `20261105_student_enrollment_history_source_reference.postgres.sql` as the documented correction. Do not rebuild or drop the table.
   - If this migration is already correctly applied, verify it read-only and do not rerun a different engine's file.

1. **Dated student placement history**
   - `20261117_student_enrollment_periods.sqlite.sql` or `20261117_student_enrollment_periods.postgres.sql`
   - Requires `schools`, `sections`, `classes`, `students`, and `student_enrollment_history`.
   - Creates the date-range placement table; does not backfill dates.

2. **Section-aware attendance**
   - `20261118_section_aware_attendance.sqlite.sql` or `20261118_section_aware_attendance.postgres.sql`
   - Requires the existing attendance table, student/class/section ownership, and compatible referenced key types.
   - SQLite rebuilds the attendance table while preserving its documented fields. PostgreSQL adds and validates `section_id`, then changes the uniqueness key.
   - Run the read-only ownership and duplicate preflight immediately beforehand.

3. **Attendance calendar foundation**
   - `20261119_attendance_calendar_foundation.sqlite.sql` or `20261119_attendance_calendar_foundation.postgres.sql`
   - Requires `schools`, `sections`, `classes`, `staff`, and `term_events`.
   - Creates academic periods, effective-dated class schedules, closures, explicit register responsibilities, and immutable foundation audit logs.

4. **Formal register submission**
   - `20261119_attendance_register_submission.sqlite.sql` or `20261119_attendance_register_submission.postgres.sql`
   - Requires the section-aware attendance uniqueness key, dated enrollment periods, and calendar responsibilities.
   - Creates formal register state and immutable submitted/reopened event history.

5. **Missing-register reminders**
   - `20261119_attendance_register_reminders.sqlite.sql` or `20261119_attendance_register_reminders.postgres.sql`
   - Requires sections, classes, staff, academic periods, schedules, responsibilities and formal attendance registers.
   - Creates one idempotent reminder record per expected class date. Staff notification-feed requests generate reminders for expected, unsubmitted dates in the current term. Submission resolves the reminder atomically.
   - This is request-driven in-app notification behavior; no cron, email, SMS or WhatsApp sender is introduced.

These migrations are manual and must not be added to `utils/migrateOnStartup.js`, application startup, deploy hooks, or an automatic migration runner.

## Required read-only preflight

Run against a verified, read-only connection to the target database. Do not use an application account with write privileges for this inspection.

### Core ownership and duplicate checks

For PostgreSQL, run the checks in `20261118_section_aware_attendance.md` and additionally inspect:

```sql
SELECT COUNT(*) AS classes_with_invalid_section_owner
FROM classes c
LEFT JOIN sections s ON s.id = c.section_id
WHERE c.section_id IS NOT NULL
  AND (s.id IS NULL OR s.school_id IS DISTINCT FROM c.school_id);

SELECT COUNT(*) AS invalid_enrollment_period_owners
FROM student_enrollment_periods ep
JOIN students st ON st.id = ep.student_id
JOIN classes c ON c.id = ep.class_id
JOIN sections sec ON sec.id = ep.section_id
WHERE st.school_id IS DISTINCT FROM ep.school_id
   OR c.school_id IS DISTINCT FROM ep.school_id
   OR sec.school_id IS DISTINCT FROM ep.school_id
   OR c.section_id IS DISTINCT FROM ep.section_id;

SELECT COUNT(*) AS overlapping_confirmed_enrollment_periods
FROM student_enrollment_periods a
JOIN student_enrollment_periods b
  ON a.school_id = b.school_id
 AND a.student_id = b.student_id
 AND a.section_id = b.section_id
 AND a.session = b.session
 AND a.id < b.id
 AND a.start_date <= COALESCE(b.end_date, DATE '9999-12-31')
 AND COALESCE(a.end_date, DATE '9999-12-31') >= b.start_date
WHERE a.date_status = 'confirmed' AND b.date_status = 'confirmed';
```

SQLite uses the same ownership joins and date overlap predicate, with `IS NOT` for distinct-value checks and `'9999-12-31'` as the open-end sentinel.

Also inspect existing rows and counts in `attendance`, `student_enrollment_periods`, `class_attendance_responsibilities`, `attendance_registers`, and any pre-existing object with the same target table names. The target register/calendar tables should be absent before their first migration unless a documented partial rollout is being reconciled.

### Stop conditions

Do not proceed if:
- attendance rows have missing student/class/section ownership, cross-school student/class links, or duplicate section-aware keys;
- a class references a section owned by another school;
- a dated enrollment row links a student, class, section, or school inconsistently;
- confirmed enrollment periods overlap for the same student/section/class/session;
- a target table already exists with an unexpected schema or data;
- the exact migration has not succeeded against a production-shaped disposable copy;
- no restorable backup has been created and independently verified.

Do not repair discrepancies by guessing dates or changing historical attendance.

## Recovery strategy

- Before any production work, take a provider-supported backup and verify that it can be restored to a separate database.
- Run the exact SQL against a disposable database built from the same schema/version and representative data.
- For a migration that fails inside its transaction, stop and inspect the transaction state and schema before retrying. Do not assume every engine/file is automatically rolled back.
- The SQLite section-aware migration rebuilds the attendance table; recovery should be by restoring the verified pre-migration database backup, not by improvising reverse SQL.
- The other migrations are additive, but dropping the new tables is not an approved rollback strategy once application data has been written. Prefer forward repair after a verified backup and a reviewed corrective script.
- Never delete immutable audit rows or rewrite attendance history as a rollback shortcut.

## Application rollout sequence

1. Verify all five foundation migrations, plus the prerequisite history migration when needed, against disposable SQLite and PostgreSQL 17.6 environments.
2. Apply approved migrations manually to the target database, one engine-specific file at a time, in the order above.
3. Verify schema, row counts, foreign keys, indexes, audit triggers, and dated enrollment coverage using read-only queries.
4. Deploy the application code only after the database schema is verified.
5. Smoke-test one class in each section, a student with a dual-section enrollment, a mid-session class transfer, draft save, complete submission, locked edits, Admin reopen with reason, and corrected resubmission.
6. Check portal and Admin reports independently for Academy and Tahfeez. Never combine their attendance totals.
7. Enable reminders only after the school confirms responsibility coverage and the reminder delivery policy. The current foundation does not yet send reminders.

## Verification boundary

The GitHub CI workflow uses disposable SQLite and PostgreSQL 17.6 databases. It cannot establish the current production schema or execute production read-only SQL. Production preflight remains pending until an authorized read-only production connection is available and the results are reviewed. No production migration, merge, or deployment is authorized here.
