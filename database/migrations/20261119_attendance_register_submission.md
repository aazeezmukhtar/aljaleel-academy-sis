# Attendance register submission foundation

This is a manual, additive migration for AcadMe. It must never be run automatically during application startup.

## Dependencies

Apply only after the target database already has:
- `schools`, `sections`, `classes`, and `staff`
- the section-aware `attendance` table, including its unique key on `(student_id, section_id, date, session, term)`
- the class attendance calendar foundation, including `class_attendance_responsibilities`

## What it adds

- `attendance_registers`: one register per school, class, section, date, session, and term.
- `attendance_register_events`: immutable submitted/reopened event history, including actor, timestamp, reason, version, and before/after attendance snapshots.

## Workflow

1. Staff assigned as the effective-dated register holder can save a draft.
2. Submission rechecks the class roster inside the same transaction, rejects empty or incomplete registers, persists attendance, records the snapshot and locks the register.
3. Ordinary draft saves and duplicate submissions are rejected while locked.
4. An Admin may reopen a submitted register only with a non-empty correction reason.
5. Reopening records the complete submitted attendance snapshot. The next submission records both the pre-correction and corrected snapshots under a new submission version.
6. Event history is protected against update and delete at database level.

## Manual rollout safeguards

- Test the matching migration against a disposable copy first.
- Review the target database's existing schema and backup/recovery position before applying.
- Do not execute this migration from `migrate.js`, application startup, a deploy hook, or an automatic migration runner.
- Do not apply to production without a separate, explicit approval.
- SQLite and PostgreSQL migrations are alternatives; execute only the one matching the target database.
