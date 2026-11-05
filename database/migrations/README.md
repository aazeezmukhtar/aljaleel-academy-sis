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

### Existing databases

If the original migration was already applied before this correction, run the matching follow-up migration:

- `20261105_student_enrollment_history_source_reference.sqlite.sql`
- `20261105_student_enrollment_history_source_reference.postgres.sql`

The SQLite follow-up rebuilds only the history table, preserving its rows and other foreign keys. The PostgreSQL follow-up drops only the generated constraint on `source_enrollment_id`.

### Preconditions

The target database must already contain `schools`, `students`, `staff`, `sections`, `classes`, and `student_enrollments`, with the school ownership columns and foreign-key-compatible ID types used by the application.

The migration does not seed missing schools, repair orphaned records, infer missing section ownership, or update current assignments. If an existing enrollment cannot join to a student and class, inspect and resolve it separately before production execution.

### Test

Run `node tests/student-enrollment-history-migration.test.js`.

The in-memory SQLite test enables foreign-key enforcement and verifies dual-section baselines, null legacy dates, source-row deletion without loss of history, idempotency, event validation, and preservation of existing enrollment rows.

PostgreSQL execution should additionally be verified against a disposable PostgreSQL database matching the deployed schema before production approval.
