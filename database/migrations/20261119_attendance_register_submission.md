# Attendance register submission foundation

This is a manual, additive migration for AcadMe. It must never be run automatically during application startup.

## Dependencies

Apply only after the target database already has:
- `schools`, `sections`, `classes`, and `staff`
- the section-aware `attendance` table, including its unique key on `(student_id, section_id, date, session, term)`\n- `student_enrollment_periods`, with reviewed/confirmed, inclusive date ranges
- the class attendance calendar foundation, including `class_attendance_responsibilities`

## What it adds

- `attendance_registers`: one register per school, class, section, date, session, and term.
- `attendance_register_events`: immutable submitted/reopened event history, including actor, timestamp, reason, version, and before/after attendance snapshots.

## Date-specific roster rule\n\nThe register service builds the roster from `student_enrollment_periods` for the exact school, section, class, session, and attendance date. Only `date_status = 'confirmed'` placements whose inclusive date range contains the attendance date are eligible.\n\n- A student transferred between classes during a session belongs to the old class through its confirmed end date and the new class from its confirmed start date.\n- A placement marked `review_needed` blocks attendance writes for that class/date until corrected.\n- A legacy `current_class_id` or undated `student_enrollments` row is not treated as proof of historical membership.\n- If no confirmed dated roster exists, a register cannot be submitted as a complete register.\n\nThis is intentional: historical eligibility must not be inferred from the student's current class.\n\n## Workflow

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
