# Shared notification delivery foundation — Phase 2J

## Scope

This phase introduces a reusable, recipient-specific in-app delivery queue. It does not yet connect attendance reminders, announcements or assignments to the queue. Attendance remains the first planned producer in Phase 2K.

## Additive data model

The `notification_deliveries` table stores:
- school and recipient identity (`staff` or `student`);
- category and source identity;
- the in-app channel;
- a school-scoped idempotency key;
- title, optional body and an internal application destination;
- scheduled time and lifecycle status;
- delivery/cancellation timestamps, attempt count and bounded error text.

The table has a unique key on `(school_id, idempotency_key)` and indexes for due dispatch, recipient history and source cancellation. Recipient IDs are checked against the matching same-school `staff` or `students` row before enqueue. Parent accounts are intentionally not supported until AcadMe has a verified parent-account identity and relationship model.

The delivery ID uses the existing integer ID width used by `notification_reads.source_id`. The source ID is BIGINT so existing attendance reminder IDs can be represented without narrowing.

## Lifecycle and service behavior

- `queued`: waiting for its scheduled time.
- `delivered`: published to the recipient's in-app notification feed.
- `read`: recipient read state has been recorded.
- `cancelled`: source workflow no longer requires delivery.
- `failed`: publication failed and the error is retained for operational recovery.

“Delivered” means available in AcadMe's in-app feed; it does not mean the recipient has seen it. No SMS, email, WhatsApp or browser-push delivery is implemented.

The shared service provides:
- `enqueue`: validates school/recipient ownership, internal destinations and idempotency. Repeated enqueue with the same key returns the existing item; reusing a key for a different recipient/source is rejected.
- `dispatchDue`: publishes due queued items in a bounded transaction. PostgreSQL uses `FOR UPDATE SKIP LOCKED` so concurrent workers do not claim the same rows. SQLite uses its transaction boundary.
- `listForRecipient`: returns only delivered/read items for the exact school, recipient type and recipient ID.
- `markRead`: checks recipient ownership and atomically changes delivery state plus inserts the matching `notification_reads` record.
- `cancel` and `cancelSource`: cancel queued deliveries only.
- `markFailed`: records a bounded failure reason for a queued delivery. Retry policy and administrator recovery UI are deferred to Phase 2L.

Read state for new deliveries uses `notification_reads` with source type `notification_delivery`; existing announcement, class-post and attendance reminder read-state rows are not modified.

## Compatibility and safety

- PostgreSQL and SQLite migrations are additive and idempotent.
- Existing attendance reminders, announcements, assignments, notification reads and attendance data are untouched.
- Existing feed queries and attendance reminder request-time delivery behavior remain unchanged in this phase.
- No existing records are backfilled or converted.
- No production migration, production data write, scheduler activation, external scheduler setup or external provider integration is included.
- Apply the migration only after review and explicit approval, using the matching active database engine migration.

## Validation

Dedicated SQLite and PostgreSQL tests cover:
- migration idempotency and schema creation;
- idempotent enqueue and rejection of idempotency-key collisions;
- same-school recipient validation;
- internal destination validation;
- future scheduling and bounded dispatch;
- concurrent PostgreSQL dispatch without duplicate publication;
- recipient and school isolation;
- atomic read-state update;
- source cancellation and single-delivery cancellation;
- failed state recording and duplicate transition protection;
- rollback if read-state persistence fails (SQLite).

Commands:
- `npm run test:shared-notification-sqlite`
- `npm run test:shared-notification-postgres`

## Next phase — Phase 2K

Integrate attendance reminder scheduling as the first producer:
1. Keep attendance deadlines, stage timing, responsibility snapshots, escalation and cancellation in attendance services.
2. Enqueue each due attendance reminder using a stable key derived from reminder ID and recipient.
3. Dispatch due in-app deliveries from the secured scheduler.
4. Read notifications from the shared delivery queue.
5. Remove feed-fetch side effects only after the new path is proven by tests.
6. Preserve old reminder records and transactional acknowledgement; use a compatibility path during transition.

Announcements and assignments remain on their current feed behavior until attendance is complete.
