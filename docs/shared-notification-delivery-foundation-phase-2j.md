# Shared notification delivery foundation — Phase 2J

## Scope

This phase introduces the reusable, recipient-specific in-app delivery queue. It is infrastructure only: announcements, assignments and attendance reminders are not yet migrated to it.

## Data model

The additive `notification_deliveries` table stores:
- school and recipient identity (`staff` or `student`);
- source type and source record ID;
- recipient-scoped idempotency key;
- category, title, optional body and destination path;
- scheduled time and delivery state;
- delivery/cancellation timestamps and bounded operational fields.

Idempotency is unique per school, recipient type, recipient ID and key. The same source may therefore notify multiple recipients, while a retry for one recipient returns the original delivery record.

The table deliberately does not use polymorphic foreign keys to staff/student/source tables. Application-level recipient authorization and school scoping are required at every retrieval boundary. Parent accounts are not accepted until a verified parent identity and relationship model is available.

## Service behavior

`services/notificationDeliveryService.js` provides:
- `enqueue`: validates and persists a recipient-specific queued delivery; duplicate keys return the original record without overwriting its content;
- `dispatchDue`: atomically claims due queued records and marks them delivered; PostgreSQL uses `FOR UPDATE SKIP LOCKED` to support concurrent workers;
- `listDeliveredForRecipient`: returns only delivered items for the exact school, recipient type and recipient ID;
- `cancelQueued`: cancels queued items for a source record that is no longer eligible.

Delivered means the item has been published to the in-app feed store. It does not mean a person has seen or read it. Existing `notification_reads` remains the read-state source for legacy feed items; acknowledgement remains a separate workflow concept.

## Safety and compatibility

- PostgreSQL and SQLite migrations are additive and create only the new delivery table and indexes.
- Existing `notification_reads`, announcements, class posts, attendance reminder rows and attendance records are not modified.
- No current notification feed behavior is changed in this phase.
- No scheduler endpoint, external channel, production migration or production data write is activated.
- The service is not yet wired into attendance. Attendance integration is a subsequent phase after this foundation is reviewed and validated.

## Tests

SQLite and PostgreSQL tests cover migration application, idempotent enqueue, recipient/school isolation, due-time dispatch, repeated dispatch, cancellation, validation and feed retrieval. PostgreSQL tests require the disposable `PG_TEST_URL` and refuse application-database fallback.
