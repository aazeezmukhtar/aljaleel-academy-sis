# Attendance register foundation (2026-11-19)

## Scope

Adds ten additive tables around the existing attendance table:
- section_academic_periods
- class_attendance_schedules
- class_attendance_responsibilities
- class_attendance_settings
- class_attendance_closures
- attendance_registers
- attendance_register_students
- attendance_register_events
- attendance_register_reminders
- attendance_foundation_audit_logs

The migration does not alter, backfill, rename, or delete existing attendance rows. The existing attendance table remains the authoritative student/day status store. The register roster snapshots expected students; it does not duplicate attendance statuses.

## Core rules

1. One register per class, section and date.
2. Expected students are snapshotted from dated student_enrollment_periods; no missing historical dates are inferred.
3. Present, Late and Leave receive full attendance credit. Absent receives zero. Leave is approved as soon as an authorized administrator or class teacher records it; there is no separate Leave approval workflow.
4. Unmarked is not Absent. Submission requires every expected student to have a deliberate, valid attendance row persisted on the server.
5. Server statuses are expected, in_progress, submitted, reopened and closed. Pending offline sync is client-only.
6. Submitted registers require a submitter, timestamps and submitted count equal to expected count. The application transaction must also verify actual attendance rows and roster membership.
7. Administrative closure never means submitted. Only approved closures suppress expected registers.
8. Schedule, responsibility and settings date overlaps, plus cross-table school/class/section/student ownership, must be validated transactionally by application services in both database engines.
9. Event timestamps are UTC; dates and deadlines use the school timezone, default Africa/Lagos. Timezone and calculated deadline are snapshotted on each register.
10. Reminder uniqueness is per register, recipient and stage; recipient is snapshotted when scheduled.

## Effective-date semantics

- Schedule weekday uses ISO numbering: Monday=1 through Sunday=7.
- Schedule, responsibility and settings intervals are inclusive. NULL effective_to means ongoing.
- Schedule changes close the old row on the preceding date and insert a new row; historical schedule references are retained.
- At most one primary responsible teacher may be active for a class/section/date. A substitute takes precedence for the period it covers.
- Academic period, enrollment period and closure start/end dates are inclusive.

## Application work still required

- Automatic expected-register generator and reconciliation job.
- Effective-date resolution for schedules, responsibilities and settings.
- Snapshot expected students using dated enrollment periods.
- Transactional submission validation against the actual attendance table.
- Shared attendance classification/calculation service for analytics, alerts, reports and student portal.
- Reminder scheduler, delivery, retries and administrator escalation.
- Offline queue reconciliation; local save must never be represented as server submission.
- Authorization for submit, reopen, correct, close and approve closure.
- Audit records for changes and overrides.
- Empty roster should be flagged for administrative review rather than silently submitted.

## Reminder settings

- submission_deadline_time is interpreted in the register timezone and converted to a UTC submission_deadline_at snapshot.
- First reminder delay defaults to zero minutes after deadline.
- Subsequent reminder intervals are ordered positive integer minutes, stored as JSONB in PostgreSQL and JSON text in SQLite. Application validation must enforce the same schema in both engines.
- Stage 1 goes to the effective responsible teacher; later stages may escalate to configured administrators.
- Reminders stop on server-confirmed submission or approved closure.

## Tests

SQLite:

    npm run test:attendance-register-sqlite

PostgreSQL 17.6 against a disposable database only:

    PG_TEST_URL='postgres://...disposable-test-db...' npm run test:attendance-register-postgres

The PostgreSQL test refuses to run without PG_TEST_URL. Never point it at production Supabase. These tests cover schema creation and representative constraints; they do not prove production schema compatibility or application workflow correctness.

## Production execution gate

This migration is manual and must never be wired into application startup.

1. Verify production column types and referenced primary keys.
2. Verify enrollment-history and dated-enrollment-period migrations and constraints.
3. Run current read-only production schema/integrity preflight.
4. Test on a disposable PostgreSQL 17.6 database matching production.
5. Obtain a recoverable production backup and independently restore it to a separate database; verify row counts and integrity.
6. Review the exact migration and recovery plan.
7. Obtain separate explicit authorization for production execution.

No legacy dates, class schedules, responsibilities or academic periods are fabricated or backfilled by this migration.