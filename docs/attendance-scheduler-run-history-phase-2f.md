# Attendance scheduler run history — Phase 2F

## Scope

Adds an append-only operational history table for attendance reminder scheduler executions. Each invocation records a running row, then a succeeded or failed outcome with completion time and summary/error details.

## Behaviour

- A run is recorded before reminder reconciliation or scheduling begins.
- Successful runs retain the scheduler's aggregate count summary as JSON.
- Failed runs retain a bounded error message and completion timestamp; the original error is still returned to the secured endpoint handler.
- A process termination can leave a row in `running`, which makes interrupted executions visible rather than falsely marking them successful.
- This phase does not change reminder recipient selection, retry policy, acknowledgement, attendance records, or notification delivery.
- The history is not yet exposed in the administrator UI; that is a follow-up phase.

## Migration

Apply exactly one migration for the active database engine:

- PostgreSQL: `database/migrations/20261120_attendance_scheduler_runs.postgres.sql`
- SQLite: `database/migrations/20261120_attendance_scheduler_runs.sqlite.sql`

The migration is additive and creates only `attendance_scheduler_runs` plus its history index. It does not update or delete existing attendance/reminder data. Production application remains a separate manual step after review and approval.

## Validation

The dedicated SQLite test validates the migration, successful run summary, failure capture, and status constraints. PostgreSQL migration validation is included in the CI follow-up before any merge.
