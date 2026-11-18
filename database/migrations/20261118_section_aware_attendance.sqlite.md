# SQLite section-aware attendance migration

File: `20261118_section_aware_attendance.sqlite.sql`

This is the SQLite counterpart to the PostgreSQL migration. It rebuilds the
attendance table because SQLite cannot drop the existing table-level UNIQUE
constraint in place. It preserves IDs, attendance statuses, dates, sessions,
terms, reason fields, and arm_id, derives section_id from the referenced class,
and installs the section-scoped unique index.

Before running, back up the SQLite file and run this migration on a copy. The
migration's guard aborts if any original row cannot be copied because its class
has no section. Verify row counts and foreign keys after execution. This is
explicit/manual and is not wired into startup.

The migration is intended for the repository's supported SQLite schema with
attendance reason columns present. If a local database has a different column
layout, inspect and adapt it rather than forcing this rebuild.
