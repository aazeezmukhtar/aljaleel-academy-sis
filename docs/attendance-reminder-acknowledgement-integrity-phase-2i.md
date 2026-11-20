# Attendance reminder acknowledgement integrity — Phase 2I

## Scope

Make the staff notification read-state and attendance reminder acknowledgement a single atomic operation.

## Behavior

- A staff member can acknowledge only a reminder addressed to their own staff ID.
- A reminder can transition from `sent` to `acknowledged`; repeated acknowledgement requests remain idempotent.
- The reminder acknowledgement update and the matching `notification_reads` insert run in one database transaction.
- If the reminder is missing, belongs to another staff member, or is not in a sent/acknowledged state, the request returns 404 and does not create a read-state row.
- If either database write fails, the transaction rolls back so the reminder and notification read state cannot diverge.
- The original acknowledgement timestamp is preserved on repeated requests.

## Explicit non-goals

- No changes to reminder scheduling, recipient selection, delivery channel, or escalation timing.
- No SMS, email, push delivery, or external-delivery retry claims.
- No new table or production migration.
- No production data changes or scheduler activation.

## Validation

The notification-handler test covers successful acknowledgement, repeated/unknown recipient handling, shared transaction use, and rollback when the read-state insert fails.
