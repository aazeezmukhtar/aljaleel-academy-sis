# Attendance notification operations — Phase 2L

## Goal

Give administrators read-only visibility into the shared in-app notification delivery queue, alongside the existing attendance register and scheduler dashboards.

## Dashboard metrics

The Attendance Operations page now reports school-scoped delivery totals for:
- queued notifications;
- queued notifications whose scheduled time has arrived (due);
- delivered notifications (available in AcadMe's in-app feed);
- read notifications;
- failed notifications;
- cancelled notifications;
- the age in minutes of the oldest queued notification.

The dashboard also lists the ten most recently updated failed deliveries, showing notification title, category/source, attempt count, update time and recorded failure detail. It does not expose recipient IDs.

## Safety and compatibility

- The dashboard is administrator-only through the existing Attendance Operations route.
- All queue queries are scoped to the current school.
- All queue inspection is SELECT-only. It does not enqueue, dispatch, retry, cancel, mark failed, mark read or otherwise mutate delivery records.
- If the shared notification migration is not installed, the page reports that queue health is unavailable and continues rendering the existing attendance operations dashboard.
- Scheduler run health and notification delivery health remain separate signals. A successful scheduler run does not imply that every notification was delivered.
- “Delivered” means available in AcadMe's in-app feed; it does not mean SMS/email delivery or proof that the recipient viewed it.

## Recovery boundary

This phase intentionally provides visibility only. It does not offer a retry button or automatically requeue failed items. Before enabling recovery actions, define and test retry eligibility, maximum attempts/backoff, idempotency behavior, terminal failure handling and audit logging. Do not replay an item merely because it is old or because a scheduler run failed.

## Validation

Service tests cover:
- PostgreSQL and SQLite migration detection;
- school-scoped queue summary and due counts;
- oldest queued age calculation;
- recent failure visibility;
- graceful behavior when the queue migration is absent;
- continued read-only behavior of the operations service.

No production migration, data write, scheduler activation or environment change is part of this phase.
