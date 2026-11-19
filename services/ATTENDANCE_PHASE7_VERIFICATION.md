# Phase 7 — Attendance foundation verification

## Verification scope

This branch is a final code/test verification pass over the attendance calendar, dated enrollment, section-aware attendance, register submission, shared analytics, administrative reports, and student portal work.

- Base: Phase 6 commit `5f011f0c1f5bbfe3203932c3aee22910393d8266`
- Branch: `phase7/final-attendance-verification`
- Production database changes: none
- Merge to `master`: not performed
- Production deployment: not performed

## Corrections made during review

### Date-specific register rosters

Register saving and submission now use confirmed `student_enrollment_periods` for the exact school, section, class, session, and attendance date.

- Class transfers are respected using inclusive placement dates.
- Review-needed enrollment dates block attendance writes until corrected.
- Current-class and undated legacy enrollment records do not establish historical eligibility.
- Register tests cover a student moving from one class to another during the same session, missing dated history, and review-needed history in SQLite and PostgreSQL.

### Schedule-aware dashboard totals

The administrative dashboard now classifies each class/date with `expectedAttendanceDaysService`. Only classes classified as `expected` contribute to expected-register totals. Submitted registers on non-opening, closed, or unknown-schedule dates are not counted as submissions against an expected register.

### Shared configurable threshold

The School Settings page already stores the attendance minimum percentage as `attendance.minimum_percentage`. The portal had been looking for a different, unconfigured key, while administrative reports defaulted to 75.

A shared `attendanceThresholdService` now reads the saved school setting (default 75 when missing/invalid). The student portal, class report, low-attendance report, and dashboard use that same configured threshold. An explicit threshold in a report filter remains a temporary report-only override.

### Migration parity

The SQLite section-aware attendance migration now checks student/class/section school ownership and duplicate groups before dropping the original attendance table, matching the PostgreSQL migration's safety intent. The SQLite test verifies that a tenant mismatch aborts without replacing the original table.

## Required acceptance coverage

The disposable preflight workflow runs:

- Dated enrollment-period migration in SQLite.
- Section-aware attendance migration in SQLite and PostgreSQL.
- Register draft, complete submission, locking, Admin reopen, audit snapshots and immutability in SQLite and PostgreSQL.
- Calendar foundation migrations and services in SQLite and PostgreSQL.
- Expected-day classification in SQLite and PostgreSQL.
- Shared attendance analytics in SQLite and PostgreSQL.
- Shared configured threshold validation.
- EJS compilation and static authorization/integration assertions for attendance reports and the student portal.

PostgreSQL tests require `PG_TEST_URL` and use isolated disposable schemas. They refuse to fall back to `DATABASE_URL`.

## Release blockers / remaining work

1. **Production read-only preflight is not complete.** This session has no direct read-only connection to the live AcadMe database. Do not treat historical preflight notes in older migration documentation as current verification. Before rollout, the live schema, existing attendance row ownership, duplicate groups, existing enrollment-period coverage, migration state, and exact referenced key types must be checked read-only.
2. **Schedule, academic-period and closure configuration has no complete Admin UI yet.** The service layer supports creation/correction/cancellation and the register-responsibility page exists, but administrators still need safe screens to configure term dates, class opening schedules, and closures. Do not ask school staff to edit these tables directly in production as a routine workflow.
3. **Missing-register reminders are not implemented.** The dashboard surfaces missing/draft data and explicit responsibilities/submission states now exist, but a reminder scheduler, recipient resolution, deduplication, and delivery audit have not been added. This remains required by the approved attendance specification.
4. **Leave approval is not represented separately in the current status schema.** The approved policy is implemented by crediting every `Leave` row fully. If the school needs pending/unapproved leave, a separate approval state must be designed before using that distinction in analytics.

## Manual migration sequence — only after read-only preflight and approval

Use exactly one database-engine variant (SQLite or PostgreSQL), not both. First inspect the live schema and determine which migrations, if any, are already present. Do not rerun a migration merely because it appears in this list.

1. `20261117_student_enrollment_periods` — only if the table is absent and its referenced `student_enrollment_history` structure is verified.
2. `20261118_section_aware_attendance` — only after verifying attendance row ownership and duplicate groups. This migration changes the attendance table/key and must be tested against a restorable production-shaped copy.
3. `20261119_attendance_calendar_foundation` — creates section academic periods, class schedules, closures, responsibilities, and immutable foundation audit logs.
4. `20261119_attendance_register_submission` — creates formal register state and immutable submission/reopen history. Requires the section-aware attendance and dated enrollment foundations.

### Before any production execution

- Obtain a fresh, read-only schema and data preflight; confirm whether any of these tables/columns already exist.
- Verify all foreign-key target types and same-school ownership.
- Measure dated enrollment-period coverage. Do not invent historical start/end dates. Mark uncertain history for review.
- Take a database backup and prove that it can be restored to a separate database.
- Run the exact ordered migration set against that restored production-shaped copy.
- Run the post-migration read-only integrity checks and the application smoke tests.
- Obtain separate explicit approval for production migration, merge, and deployment. These are three distinct actions.

### Recovery approach

Do not assume that dropping the new tables is a safe rollback after attendance data has been written. Prefer a tested forward-fix for additive calendar/register tables. The section-aware attendance table rebuild requires a verified pre-migration backup and a rehearsed restore procedure. Keep audit history; do not delete or rewrite it to force a rollback.

## Current disposition

Phase 7 changes remain isolated on this branch. A passing disposable CI run is necessary but does not replace the outstanding live read-only preflight, missing configuration UI, or reminder implementation. Production is not approved for rollout yet.
