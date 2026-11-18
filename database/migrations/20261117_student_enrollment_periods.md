# Dated student enrollment periods (2026-11-17)

Files:
- `20261117_student_enrollment_periods.sqlite.sql`
- `20261117_student_enrollment_periods.postgres.sql`

## Purpose

Adds `student_enrollment_periods` as a date-range record for each class placement. It complements rather than replaces:

- `student_enrollments`: current/session-based class assignments.
- `student_enrollment_history`: append-only event and audit ledger.
- `student_enrollment_periods`: dated placement intervals, with inclusive start and end dates.

The table is section-scoped. Academy and Tahfeez placement timelines remain independent. `school_id` is retained for ownership consistency; application services must validate that the student, section, class, and referenced events belong to the same school.

## Date conventions

- `start_date` is the first officially enrolled day in the placement.
- `end_date` is the last officially enrolled day, inclusive; NULL means the placement is ongoing.
- A transfer ends the source period on the day before the destination period starts.
- Admission and each section's promotion/repetition require an explicitly supplied commencement date.
- Graduation and departure close the relevant section period on the last officially enrolled day.
- Legacy placements are not inserted by this migration because their original dates are unknown. Do not fabricate dates or automatically mark them confirmed.

`date_status` supports `confirmed` and `review_needed` so later, evidence-based reconciliation can distinguish verified dates from dates requiring review.

## Safety and execution

This is an explicit, additive migration. It is not wired into application startup and must not be run automatically in production. It does not modify enrollment, attendance, results, student status, or existing history rows.

Before execution:
1. Verify the live PostgreSQL schema contains the referenced tables and compatible key types.
2. Verify the existing `student_enrollment_history` migration has been applied and inspect its foreign keys.
3. Run against a disposable PostgreSQL database matching the deployed schema.
4. Take and verify a recoverable backup before any production execution.

The migration intentionally does not add a `school_id` column to `student_enrollments`. Ownership is checked through the student and class records by the application service.

Overlapping placement prevention is an application-service responsibility and must be enforced transactionally in both SQLite and PostgreSQL. These foundation migrations do not infer or backfill periods from legacy event timestamps.
