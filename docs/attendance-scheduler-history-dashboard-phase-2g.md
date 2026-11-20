# Attendance scheduler history dashboard — Phase 2G

## Scope

Expose the durable scheduler execution records from Phase 2F on the existing administrator-only Attendance Operations page.

## Behaviour

- Shows the latest 20 scheduler executions with start time, completion time or elapsed age, status, aggregate summary, and bounded error message.
- Counts succeeded, failed, running, and potentially interrupted runs within the displayed 20-run window.
- A run still marked `running` after 15 minutes is labelled **Possibly interrupted**. This is an investigation signal only; the dashboard does not change its status or retry it.
- Detects whether `attendance_scheduler_runs` exists before querying it. If the Phase 2F migration has not been applied, the page displays a clear migration-not-installed notice and continues to show the attendance operations data.
- PostgreSQL and SQLite table detection are both covered by tests.

## Safety

- Administrator-only page; existing route authorization remains in force.
- Read-only SELECT queries only. No scheduler execution, register generation, reminder delivery, acknowledgement, or attendance writes.
- No production migration is applied by this change.
- The existing run-history migration from Phase 2F remains a separate manual production step.

## Important delivery semantics

Attendance reminders currently appear in the staff in-app notification feed. The application marks a reminder sent when that feed retrieves it; this is not SMS or email delivery. This phase intentionally does not add a misleading external-delivery retry mechanism.

## Validation

- Extend attendance operations tests to cover migration absent/present, PostgreSQL and SQLite detection, successful and failed runs, and stale running records.
- Full regression workflow remains required before merge.
