# Attendance reminders on the shared notification engine — Phase 2K

## Goal

Make the attendance scheduler the only process that publishes attendance reminders. Opening or refreshing a notification feed must never deliver reminders or change their delivery state.

## Delivery flow

1. Attendance policy remains in `attendanceRegisterReminderService`: it reconciles expected registers, applies configured deadlines and reminder intervals, resolves the responsibility snapshot and administrator escalation recipients, and creates the existing `attendance_register_reminders` rows.
2. For each pending reminder, the scheduler enqueues one shared in-app delivery using:
   - category `attendance`;
   - source type `attendance_register_reminder`;
   - source ID equal to the existing reminder row ID;
   - idempotency key `attendance-reminder:<reminder-id>:staff:<staff-id>`;
   - recipient type `staff` and the same school as the register;
   - scheduled time copied from the reminder row;
   - an internal attendance-register destination.
3. The scheduler dispatches due queue items and synchronizes successful delivery state back to the existing reminder row (`pending` to `sent`). A repeated scheduler run reuses the idempotency key and cannot create another delivery.
4. The staff notification feed reads delivered/read attendance items from the shared queue. It does not enqueue, dispatch or change reminder status.
5. Existing `sent`/`acknowledged` reminder rows remain visible during migration, without being copied or deleted.

## Cancellation and acknowledgement

- Future reminders are enqueued before their scheduled time, allowing the scheduler to cancel queued deliveries when a register is submitted/closed or an approved closure applies.
- Cancellation affects queued deliveries only. A notification already delivered remains visible as a historical notification.
- Acknowledgement continues to update the existing attendance reminder row and the legacy `notification_reads` entry.
- When a shared delivery exists, the same transaction also changes its status to `read` and inserts its delivery-specific `notification_reads` row. Repeated acknowledgement remains idempotent.
- The staff recipient and school are checked before delivery retrieval and acknowledgement.

## Migration compatibility

The shared delivery migration from Phase 2J is additive and must be applied before queue-backed delivery is used. Until it is installed, the attendance scheduler uses the existing reminder status transition as a compatibility delivery path. This fallback is scheduler-owned, not triggered by notification feed requests. Once the queue migration is installed, the scheduler uses the shared queue.

No existing attendance reminder rows are backfilled. Old `sent` and `acknowledged` rows continue to appear in the feed. Announcement and assignment feed behavior is unchanged.

## Operational summary

The attendance scheduler run summary now includes:
- `queuedDeliveryCount`: newly created shared queue items for attendance reminders;
- `dispatchedDeliveryCount`: shared queue items dispatched during this run;
- `legacySchedulerDeliveryCount`: reminders delivered through the compatibility path when the shared queue migration is absent.

“Delivered” continues to mean available in AcadMe's in-app notification feed, not SMS/email delivery or proof that a staff member has seen it.

## Validation

SQLite and PostgreSQL attendance workflow tests verify:
- the scheduler publishes the responsible-teacher reminder;
- administrator escalation is also scheduler-published;
- repeated runs do not create duplicate delivery rows;
- a future queued reminder is cancelled after the register is submitted;
- old reminder acknowledgement behavior remains valid;
- notification feed retrieval is read-only;
- queue-backed acknowledgement updates the reminder, delivery and read records atomically.

## Not included

- Announcement or assignment migration.
- SMS, email, WhatsApp or browser push.
- Production migration application or scheduler activation.
- Changes to attendance deadlines, schedule policy, thresholds, leave handling or analytics.
