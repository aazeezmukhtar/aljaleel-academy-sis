# Attendance schedule-set migration (2026-11-21)

## Scope

This additive/manual migration introduces section defaults and full class overrides using normalized schedule sets:

- \`attendance_schedule_sets\` stores scope, ownership and inclusive effective dates.
- \`attendance_schedule_days\` stores the complete weekly weekday list (ISO Monday=1 through Sunday=7).
- \`attendance_registers.schedule_set_id\` snapshots the schedule set used for a newly generated register.
- The legacy \`attendance_registers.schedule_id\` reference and \`class_attendance_schedules\` rows remain intact for historical registers.

No schedules, overrides, academic periods or school data are seeded. The migration does not alter the legacy \`attendance\` table and does not enable scheduler delivery.

## Files

- \`20261121_attendance_schedule_sets.postgres.sql\`
- \`20261121_attendance_schedule_sets.sqlite.sql\`
- Read-only preflight and postflight scripts are provided for PostgreSQL and SQLite.

## Important SQLite note

SQLite cannot drop the NOT NULL property from an existing column in place. The SQLite migration rebuilds \`attendance_registers\`, copies every existing register field and ID, then restores the original table name. It temporarily disables foreign-key enforcement only for the migration transaction and uses legacy alter-table behavior so existing child-table references continue to point to \`attendance_registers\`.

The migration test checks the preserved register ID and legacy schedule ID, all three dependent register child references, the new schedule-set reference, the exactly-one-source check, and \`PRAGMA foreign_key_check\`. Do not execute the SQLite migration twice.

## Application behavior

The shared resolver in \`services/attendanceScheduleService.js\`:

1. Resolves an effective class override first.
2. Uses the complete override weekday list without merging section days.
3. Falls back to the effective section default only when no class override exists.
4. Returns a missing configuration result when neither scope has a set.
5. Fails closed on multiple effective sets or an empty effective set.
6. Uses ISO weekday numbering and date-only comparisons; callers must supply the Africa/Lagos local calendar date.

Schedule creation is administrator-only, validates section/class ownership and weekday uniqueness, rejects same-scope date overlaps, serializes PostgreSQL writes with the existing school-row lock, audits changes, and refuses ranges that would reinterpret dates with already generated registers.

This phase does not yet replace the existing setup UI or switch register generation, reminders, operations, analytics or portal consumers. Those integrations are subsequent reviewable work and must use this resolver rather than independently querying schedule tables.

## Tests

Run:

\`\`\`sh
npm run test:attendance-schedule
\`\`\`

PostgreSQL migration validation must run only against a disposable PostgreSQL 17.6 database with an explicit \`PG_TEST_URL\`. Never point a test URL at production Supabase.

## Production gate

These migration files are not wired into application startup. Production execution requires:

1. Current read-only production preflight.
2. Verification of the actual production column types, constraints, indexes and foreign keys.
3. A recoverable backup and independent restore test.
4. Disposable PostgreSQL 17.6 validation matching production.
5. Review of the exact migration and recovery plan.
6. Separate explicit user approval.

Migration and entry of the actual Academy/Tahfeez schedules are separate approval steps.
