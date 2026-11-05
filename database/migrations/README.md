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
5. Uses the unique `source_enrollment_id` to make baseline import idempotent.

### Preconditions

The target database must already contain `schools`, `students`, `staff`, `sections`, `classes`, and `student_enrollments`, with the school ownership columns and foreign-key-compatible ID types used by the application.

The migration does not seed missing schools, repair orphaned records, infer missing section ownership, or update current assignments. If any existing enrollment cannot join to a student and class, it is not silently fabricated into history; inspect and resolve it separately before production execution.

### Test

Run:

```sh
node tests/student-enrollment-history-migration.test.js
```

The test uses an in-memory SQLite database with synthetic records. It verifies dual-section baselines, null legacy dates, event validation, idempotent re-execution, and preservation of the original enrollment rows.

PostgreSQL execution should additionally be verified against a disposable PostgreSQL database matching the deployed schema before production approval.
