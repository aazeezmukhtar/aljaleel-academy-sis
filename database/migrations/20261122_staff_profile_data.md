# Staff profile data foundation (2026-11-22)

## Scope

This additive schema foundation creates four tables linked to the existing `staff` account table:

- `staff_personal_details`: date of birth, gender, phone, residential address and state of origin (one optional row per staff member).
- `staff_employment_details`: department, employment type, date employed, employment status and optional staff supervisor (one optional row per staff member).
- `staff_qualifications`: multiple optional qualification records, including institution, course, certificate reference, teaching specialisation and nullable verification metadata.
- `staff_emergency_contacts`: multiple optional emergency contacts per staff member.

The existing `staff` table remains the source of account identity, login ID, system role, password, existing email, designation and profile image. No existing staff columns or rows are altered.

## Nullability and ownership

All profile attributes are nullable. A staff member does not need a populated profile row to retain a valid account. The only required values in the child tables are their primary keys and the `staff_id` ownership reference for repeatable child records. The one-to-one tables use `staff_id` as their primary key.

The staff ownership foreign keys cascade only when a staff account is deleted, matching the existing staff deletion behavior. Optional supervisor and verifier references become NULL if that staff account is deleted. No personal, employment, qualification or emergency-contact values are seeded or inferred.

## Files and validation

- `20261122_staff_profile_data.sqlite.sql`
- `20261122_staff_profile_data.postgres.sql`
- `tests/staff-profile-data-migration.test.js`

Run `npm run test:staff-profile-data-migration`.

The SQLite test uses an in-memory database, checks all four tables and nullable attributes, permits multiple qualifications and emergency contacts, verifies staff ownership constraints, and confirms safe reruns without changing existing staff rows.

## Application and production status

This change adds schema only. It does not change staff registration, profile routes, forms, permissions, or application startup. No migration is executed against production. Production execution requires a separate read-only preflight, disposable PostgreSQL 17.6 validation against the actual schema, a verified recovery plan, and explicit approval.
