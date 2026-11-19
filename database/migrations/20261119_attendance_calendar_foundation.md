# Attendance calendar foundation (2026-11-19)

## Scope and safety

This is an additive database foundation for AcadMe attendance analytics. It is explicitly/manual and must never be wired into `utils/migrateOnStartup.js`. It creates four operational tables and one immutable audit table. It does not alter attendance, student enrolment, results, staff assignments, calendar events, or existing history rows. It does not seed or infer historical schedules, academic dates, closures, or register-responsible teachers.

Run only against a disposable database during this preflight. Production execution requires a separate approval and a verified recoverable backup.

## Files

- `20261119_attendance_calendar_foundation.sqlite.sql`
- `20261119_attendance_calendar_foundation.postgres.sql`

## Tables

1. `section_academic_periods`: one explicitly configured date range per school/section/session/term. The database enforces uniqueness and date ordering. Overlap between different terms in the same section/session is rejected transactionally by the future service.
2. `class_attendance_schedules`: effective-dated weekly opening days per class and session. Class section ownership is derived from `classes.section_id`; no duplicate section column is stored. Periods are inclusive. A gap is unknown configuration, not a closure.
3. `class_attendance_closures`: one-day closure at school, section, or class scope. Scope CHECK constraints enforce valid target columns. Active closures are unique per target/date; a cancelled closure remains as history and can be re-created. A school closure overrides all narrower scopes for expected-day calculation. Multiple applicable scopes are deduplicated by date.
4. `class_attendance_responsibilities`: explicit, effective-dated class register responsibility. A form teacher is never silently assigned. Unconfigured historical periods remain unassigned.
5. `attendance_foundation_audit_logs`: immutable audit history for creation, correction, closure and cancellation of foundation records. Every correction/cancellation requires a reason. Old/new values, actor and timestamp are retained. The audit write and data change must share one transaction in the application service.

## Ownership and validation

Foreign keys enforce entity existence. Application services must additionally verify same-school ownership for every school/class/section/staff/event relationship, confirm that a class belongs to the selected section, and confirm that staff is eligible for the assignment. A closure linked to `term_events` must validate event school, date and scope. Deleting a source calendar event sets only the optional link to NULL; it does not delete the closure.

Overlap prevention for academic periods, class schedules and responsibility periods is an application-service responsibility in both database engines. Validate inside a write transaction; use a PostgreSQL row lock where appropriate and SQLite's serialized write transaction. Effective periods are inclusive. When responsibility or schedule changes on date D, close the previous period on D-1 and start the new period on D.

The audit log is append-only. Database triggers reject UPDATE and DELETE. Do not provide ordinary application routes for audit mutation. Store valid JSON in SQLite TEXT and PostgreSQL JSONB.

## Expected-day precedence

For each class/date:
1. Resolve the selected section's academic period and ensure the date is inside it.
2. Resolve the class's schedule effective on that date.
3. If no schedule exists, return unknown schedule; do not infer a weekday or mark a register missing.
4. If the weekday is not an opening day, return non-opening day.
5. Apply active school, section and class closures. Any applicable closure excludes the date; overlapping closure scopes count once.
6. For student-level eligibility, intersect the expected date with the student's confirmed dated enrolment period for that class/section/session.

The expected-day service must never combine Academy and Tahfeez. Approved Leave remains a full attendance credit in the later analytics calculation, not a closure.

## Known limits intentionally handled in services

- SQL foreign keys do not by themselves enforce same-school ownership across separate parent tables. Validate this transactionally in application services.
- SQL uniqueness does not prevent date-range overlaps. Validate transactionally in application services for both SQLite and PostgreSQL.
- A unique term key does not prevent overlapping term date ranges.
- Historical corrections must preserve the audit record and must not silently rewrite published analytics. Later analytics recalculation must be explicit.
- No schedule or responsibility history may be backfilled from current form teacher or assignment rows.

## Disposable test plan

SQLite:
`node tests/attendance-calendar-foundation-migration.test.js`

PostgreSQL:
`PG_TEST_URL=<disposable-postgres-url> node tests/attendance-calendar-foundation-postgres.test.js`

The PostgreSQL test refuses to fall back to `DATABASE_URL`. It creates and drops an isolated schema in the supplied disposable database. Never point `PG_TEST_URL` at production.

Before any future production migration: inspect the live schema read-only, confirm all referenced key types and ownership, take and verify a restorable backup, run the exact migration against a production-shaped disposable copy, and obtain separate explicit approval.

## Required overlap and ownership service test matrix

The migration deliberately does not attempt to enforce date-range overlap with engine-specific exclusion constraints. The application service must run the overlap check and write inside the same transaction.

Inclusive interval overlap predicate:

`existing.effective_from <= COALESCE(new.effective_to, '9999-12-31') AND COALESCE(existing.effective_to, '9999-12-31') >= new.effective_from`

Apply the equivalent predicate to:
- academic periods, keyed by school + section + session;
- class schedules, keyed by school + class + session;
- register responsibilities, keyed by school + class + session.

Required tests for each interval type:
- exact duplicate is rejected;
- partial overlap from the left and right is rejected;
- a new interval contained by an existing interval is rejected;
- an existing interval contained by the new interval is rejected;
- same-day overlap is rejected (inclusive endpoints);
- adjacent intervals are accepted only when the previous end is the day before the next start;
- an open-ended existing interval blocks later intervals;
- an open-ended new interval blocks later existing intervals;
- different sections/classes/sessions do not conflict;
- correction that creates an overlap is rejected and leaves both the original row and audit history unchanged;
- two concurrent writers attempting overlapping intervals cannot both commit.

Concurrency requirements:
- PostgreSQL: lock a stable parent row (class for schedules/responsibilities, section for academic periods) with `SELECT ... FOR UPDATE` before checking overlap and writing. A row-level lock on only the candidate record is insufficient when no candidate exists yet.
- SQLite: perform the check and write inside a serialized `BEGIN IMMEDIATE` transaction.
- Retry/serialization errors must not be converted into success; callers should receive a conflict result.

Required ownership tests:
- valid same-school class/section/staff/event links succeed;
- class from another school is rejected;
- section from another school is rejected;
- staff actor or assigned responsible teacher from another school is rejected;
- linked term event from another school is rejected;
- class whose `section_id` does not match the selected section is rejected;
- linked event date or scope inconsistent with the closure is rejected;
- every rejected operation leaves no business row and no audit row.

Audit atomicity tests:
- force the audit insert to fail (for example, invalid actor FK) after the business write has been attempted;
- assert the transaction rolls back the business write;
- assert correction/cancellation and audit append either both commit or neither commits;
- assert audit rows cannot be updated or deleted.

These are service-level acceptance tests, not claims that the current migration alone enforces the rules. The matching service implementation and its tests are a later implementation phase. The present preflight migration test exercises DDL constraints and transaction rollback only.

## Expected-attendance-days service (isolated implementation phase)

- Service: `services/expectedAttendanceDaysService.js`
- API: `calculate({ schoolId, sectionId, classId, session, term, startDate, endDate, studentId? })`
- The service is read-only. It does not write attendance, alter calendars/enrolments, calculate percentages, issue reminders, or change routes/UI.
- Class dates are classified as `expected`, `closed`, `non_opening`, `unknown_schedule`, `outside_term`, or `unknown_period`.
- With `studentId`, the service additionally requires a dated placement in the exact school/section/class/session. Confirmed enrollment start/end dates are inclusive. Dates with no confirmed placement are `outside_enrollment`; missing or review-needed enrollment history is `unknown_enrollment`, never assumed eligible.
- The requested range is returned in full. Dates outside the selected term are explicitly marked `outside_term`; a missing term configuration yields `unknown_period` rather than guessed term dates.
- Effective-dated class schedules are evaluated per date. Schedule gaps are `unknown_schedule`, not non-opening days or closures.
- Closures are applied only to opening days. School, section and class closures can all apply on one date; that date is classified once as `closed`, with all applicable closure IDs retained. Cancelled closures are ignored.
- Every lookup is scoped by school and the explicitly selected section. The class is verified to belong to that section; Academy and Tahfeez are never combined.
- The service returns per-day classifications, status counts and warnings. Approved Leave is not handled here; it remains a full attendance credit in the later attendance analytics layer.

Disposable tests:
- `node tests/expected-attendance-days-service.test.js`
- `PG_TEST_URL=<disposable-postgres-url> node tests/expected-attendance-days-postgres.test.js`

These tests use isolated SQLite memory and PostgreSQL temporary-schema fixtures. The PostgreSQL test refuses to use `DATABASE_URL`.
