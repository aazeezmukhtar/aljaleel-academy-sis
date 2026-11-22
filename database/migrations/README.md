# Database migrations

## Student enrollment history foundation (2026-11-05)

Files:

- `20261105_student_enrollment_history.sqlite.sql`
- `20261105_student_enrollment_history.postgres.sql`

This is an explicitly executed, additive migration. It is intentionally **not** wired into application startup.

### What it does

1. Creates `student_enrollment_history` without changing `student_enrollments`.
2. Adds indexes for student and section timeline lookups.
3. Imports one `legacy_baseline` event for each existing enrollment whose student has a `school_id`.
4. Leaves `effective_date` NULL for legacy baselines because the existing enrollment record does not establish its original start date.
5. Uses unique `source_enrollment_id` as a scalar provenance identifier for idempotency. It is deliberately not a foreign key: current assignment rows may be replaced or removed while history must remain.

### Existing PostgreSQL databases

If the original PostgreSQL migration was already applied before this correction, run `20261105_student_enrollment_history_source_reference.postgres.sql` to remove the generated source-enrollment FK. The SQLite foundation is corrected for fresh migration runs. An SQLite database that already ran the earlier version needs a separately validated table rebuild; do not assume re-running the corrected create script alters an existing table.

### Preconditions

The target database must already contain `schools`, `students`, `staff`, `sections`, `classes`, and `student_enrollments`, with the school ownership columns and foreign-key-compatible ID types used by the application.

The migration does not seed missing schools, repair orphaned records, infer missing section ownership, or update current assignments. If an existing enrollment cannot join to a student and class, inspect and resolve it separately before production execution.

### Test

Run `node tests/student-enrollment-history-migration.test.js`.

The in-memory SQLite test enables foreign-key enforcement and verifies dual-section baselines, null legacy dates, source-row deletion without loss of history, idempotency, event validation, and preservation of existing enrollment rows.

PostgreSQL execution should additionally be verified against a disposable PostgreSQL database matching the deployed schema before production approval.

## Dated student enrollment periods (2026-11-17)

Files:

- `20261117_student_enrollment_periods.sqlite.sql`
- `20261117_student_enrollment_periods.postgres.sql`
- `20261117_student_enrollment_periods.md`

This is a separate additive foundation. It creates `student_enrollment_periods` for section-scoped placement date ranges while leaving `student_enrollments`, `student_enrollment_history`, attendance, results, and student status unchanged. It is not wired into application startup and does not backfill or invent legacy dates.

See the dedicated migration note for the date conventions, ownership checks, preconditions, and production safety requirements.

### Test

Run `node tests/student-enrollment-periods-migration.test.js`.

The in-memory SQLite test verifies the schema, foreign-key-backed references, date ordering, supported date statuses, and safe reruns. PostgreSQL must also be tested against a disposable database matching the deployed schema before production approval.

## Section-aware attendance foundation (2026-11-18)

Files:

- `20261118_section_aware_attendance.postgres.sql`
- `20261118_section_aware_attendance.md`

This is an explicit/manual PostgreSQL migration. It adds attendance section ownership by deriving each existing row's section from its class, verifies ownership and duplicate invariants, and replaces the legacy global uniqueness key with a section-scoped key. It is not wired into application startup. Review the migration note and rerun all read-only preflight queries immediately before any production execution.

The application save path now derives section from the selected class on the server, requires a configured session/term, and checks the student's membership in the selected class for that session (with the existing legacy current-class fallback only when no session enrollment exists).

### Test

Run `npm run test:attendance-section`. This SQLite invariant test checks class-derived backfill and independent same-day attendance for separate sections. It is not a substitute for running the migration against a disposable PostgreSQL database matching production.


The SQLite counterpart is `20261118_section_aware_attendance.sqlite.sql`. It rebuilds
the attendance table to replace the old table-level unique constraint while
preserving IDs, status, date, session, term, reason fields, and arm_id. It is
also explicit/manual and must be tested on a backup copy before use. Run
`npm run test:attendance-sqlite` for the disposable in-memory preservation test.

Historical attendance registers now use `student_enrollment_periods` where
placement dates overlap the selected month, and include students with recorded
attendance in that month to preserve legacy evidence. Legacy enrollment dates
are not inferred. The dated-period migration must exist before this report
query is deployed.


## Attendance register foundation (2026-11-19)

Files:

- `20261119_attendance_register_foundation.postgres.sql`
- `20261119_attendance_register_foundation.sqlite.sql`
- `20261119_attendance_register_foundation.md`

This additive/manual migration creates the section academic-period, class schedule, staff responsibility, class settings, closure, register, expected-student snapshot, event, reminder, and audit tables. It leaves the existing `attendance` table and all existing attendance rows unchanged. It relies on the previously introduced `student_enrollment_periods` table for dated roster membership. No historical dates or schedules are inferred. It is not wired into startup.

Run the SQLite disposable migration test with `npm run test:attendance-register-sqlite`. Run PostgreSQL only against a disposable PostgreSQL 17.6 database with `PG_TEST_URL` set, using `npm run test:attendance-register-postgres`. Never point that test at production Supabase. See the dedicated migration note for invariants, application work still required, and production safety gates.


## Attendance section defaults and class overrides (2026-11-21)

Files:

- \`20261121_attendance_schedule_sets.postgres.sql\`
- \`20261121_attendance_schedule_sets.sqlite.sql\`
- \`20261121_attendance_schedule_sets.md\`
- \`20261121_attendance_schedule_sets_preflight.postgres.sql\`
- \`20261121_attendance_schedule_sets_preflight.sqlite.sql\`

This additive/manual migration introduces normalized section/class schedule sets and weekday rows. New registers can reference the exact schedule set used at generation while legacy registers retain their original \`schedule_id\`. The SQLite variant rebuilds \`attendance_registers\` to make the legacy reference nullable and preserve dependent child-table references. Neither migration seeds actual schedules or academic periods, alters the legacy \`attendance\` table, or runs at application startup.

The shared resolution and validation service is \`services/attendanceScheduleService.js\`. Its tests cover inherited defaults, full class replacement, date-scoped fallback, section isolation, expected-day checks and fail-closed conflict detection.

Run:

\`\`\`sh
npm run test:attendance-schedule
\`\`\`

Production execution remains a separate approval step after read-only preflight, verified backup/restore, and disposable PostgreSQL 17.6 validation. Do not execute either migration against production without separate explicit approval.


## Staff information foundation (2026-11-22)

Files:

- `20261122_staff_information.postgres.sql`
- `20261122_staff_information.sqlite.sql`
- `20261122_staff_information.md`

This additive/manual migration creates separate staff personal details, employment details, emergency contacts, and qualification records. It leaves existing staff and assignment records unchanged and does not backfill personal or employment data. It is not wired into application startup. Review the dedicated migration note for constraints and production safety gates.

Run `npm run test:staff-information-migration` for the in-memory SQLite preservation and constraint checks. PostgreSQL validation must use a disposable PostgreSQL 17.6 database matching production; never point it at production Supabase.
