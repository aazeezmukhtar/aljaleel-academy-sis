# Staff information foundation (2026-11-22)

## Scope

This additive, manually executed migration introduces four staff-linked data areas:

- `staff_personal_details`: optional personal and contact information (one row per staff member).
- `staff_employment_details`: optional employment metadata (one row per staff member).
- `staff_emergency_contacts`: multiple emergency contacts per staff member, with at most one primary contact.
- `staff_qualifications`: multiple qualifications per staff member, with pending/verified/rejected verification state.

Existing `staff` columns remain the source of truth for login identity, name, staff ID, role, account status, designation and profile avatar. Class and subject assignment tables remain the source of truth for assignments.

## Preservation and security

- The migration does not update, backfill, rename, or delete any existing staff rows or assignment rows.
- New columns are nullable unless required to create a meaningful child record.
- Each table includes `school_id` for tenant-scoped application queries.
- Child rows reference the existing staff primary key and cascade only when a staff record is explicitly deleted under existing application policy.
- Only one emergency contact may be marked primary per staff member.
- A verified qualification requires a verification timestamp.
- The migration is not wired into application startup and must not be run automatically against production.

## Files and validation

- `20261122_staff_information.postgres.sql`
- `20261122_staff_information.sqlite.sql`
- `tests/staff-information-migration.test.js`

Run `node tests/staff-information-migration.test.js`. PostgreSQL validation must additionally use a disposable PostgreSQL 17.6 database matching production; never point it at production Supabase.

## Production gate

Before production execution, perform a read-only schema preflight, verify staff ID types and foreign keys, test the exact migration against a disposable PostgreSQL 17.6 copy, and confirm a recoverable backup/restore. Production migration execution requires separate explicit approval.
