# Attendance register submission foundation

This is a manual, additive migration for AcadMe. It must never be run automatically during application startup.

## Dependencies

Apply only after the target database already has:
- `schools`, `sections`, `classes`, and `staff`
- the section-aware `attendance` table, including its unique key on `(student_id, section_id, date, session, term)`
- `student_enrollment_periods`, with confirmed/review-needed dated placement history
- the class attendance calendar foundation, including `class_attendance_responsibilities`

## What it adds

- `attendance_registers`: one register per school, class, section, date, session, and term.
- `attendance_register_events`: immutable submitted/reopened event history, including actor, timestamp, reason, version, and before/after attendance snapshots.

## Workflow

1. Staff assigned as the effective-dated register holder can save a draft.
2. The register-date roster is derived from confirmed `student_enrollment_periods` for the exact school, section, class, session and date. Current class assignments never establish historical eligibility.
3. Submission rechecks that dated roster inside the same transaction, rejects empty or incomplete registers, and refuses submission when active legacy class members have missing or review-needed dates. Such members are surfaced for administrator review rather than assigned invented dates.
4. Unmarked students remain unrecorded; blank statuses may remain in a draft but cannot satisfy submission completeness. The interface must never default an unmarked student to Absent.
5. Submission persists attendance, records the snapshot and locks the register.
6. Ordinary draft saves and duplicate submissions are rejected while locked.
7. An Admin may reopen a submitted register only with a non-empty correction reason.
8. Reopening records the complete submitted attendance snapshot. The next submission records both the pre-correction and corrected snapshots under a new submission version.
9. Event history is protected against update and delete at database level.

## Manual rollout safeguards

- Test the matching migration against a disposable copy first.
- Review the target database's existing schema and backup/recovery position before applying.
- Do not execute this migration from `migrate.js`, application startup, a deploy hook, or an automatic migration runner.
- Do not apply to production without a separate, explicit approval.
- SQLite and PostgreSQL migrations are alternatives; execute only the one matching the target database.
