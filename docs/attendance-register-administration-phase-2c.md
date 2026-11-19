# Attendance register administration — Phase 2C

## Scope

This phase adds one controlled administrative action: reopening a submitted register so that an authorized correction can be made through the existing save-progress workflow.

It does not add closure request/approval screens, reminders, analytics, or portal changes.

## Reopen rules

- Only a staff account whose database role is `Admin` and whose school matches the register may reopen it.
- Only a register currently in `submitted` state may be reopened. A pending, in-progress, already reopened, or administratively closed register is not accepted.
- A non-empty reason (maximum 500 characters) is mandatory.
- The operation locks the register row in PostgreSQL and runs in the same transaction as its event and audit records.
- The register moves to `reopened`; `submitted_student_count` resets to zero and `submitted_by` is cleared.
- The first and last submission timestamps are retained as historical evidence. The reopen event records the prior submitter, prior submitted count and prior last-submitted timestamp.
- Both `attendance_register_events` and `attendance_foundation_audit_logs` record the actor and reason.
- Once reopened, the existing workflow service permits authorized progress saves and corrections. Resubmission remains subject to all normal roster/status checks.

## Interface

On a submitted register, administrators see **Reopen for Correction**. The action requires a reason and calls `POST /attendance/reopen`. Other users do not see the control, and the server independently verifies the administrator role; hiding the button is not treated as authorization.

## Validation

The SQLite and PostgreSQL workflow tests exercise:
- teacher rejection;
- required reason validation;
- successful administrator reopening;
- duplicate/non-submitted reopen rejection;
- event and audit-log persistence;
- correction/unmarking after reopening.

The attendance UI guard test verifies the route and administrator-only control. CI remains the authoritative test runner; no test uses the production database.

## Safety boundary

No production migration, production database access, production write, merge, or deployment is part of this phase. The feature depends on the additive register foundation and submission workflow PRs being reviewed and integrated first.
