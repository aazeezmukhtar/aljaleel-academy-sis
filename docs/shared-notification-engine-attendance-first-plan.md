# Shared notification engine — attendance-first implementation plan

## Goal

Establish a reusable notification foundation for AcadMe while completing attendance reminders as the first fully implemented and operationally verified workflow.

Announcements, assignments, fee reminders and result-publication notifications are future consumers of the shared foundation. They are not implementation scope for the attendance completion phases.

## Current repository baseline

The current notification feed already combines:
- published school announcements;
- class posts and assignments;
- attendance-register reminders for staff.

Read state is stored in `notification_reads`. Attendance has additional domain-specific records in `attendance_register_reminders`, staged escalation rules, a secured scheduler endpoint, durable scheduler run history, an operations dashboard and transactional acknowledgement.

Important current behavior: an attendance reminder is changed from pending to sent when the staff notification feed retrieves it. This is in-app delivery only; it is not SMS, email or browser-push delivery. The shared engine should remove this request-time side effect and make delivery a deliberate, durable processing step.

## Architectural direction

Use one shared in-app notification delivery pipeline with feature-specific producers.

### Shared responsibilities

1. **Notification envelope** — stable source identity, school, recipient type and ID, title/body, destination, category, scheduled time, status and idempotency key.
2. **Queue and dispatcher** — publish due notifications to the in-app notification feed without depending on a recipient opening or refreshing the feed.
3. **Recipient isolation** — every queued item is addressed to a specific school-scoped staff member or student. Parent recipients must be added only when the application has a verified parent-account identity and relationship model.
4. **Idempotency** — repeated, overlapping and retried scheduler runs must not create duplicate recipient notifications.
5. **Lifecycle** — distinguish queued, delivered-to-in-app, read, cancelled and failed states. “Delivered” means made available in the AcadMe in-app feed, not confirmed seen by a person.
6. **Acknowledgement** — preserve the existing attendance rule that a staff member can acknowledge only their own reminder, and preserve the atomic relationship between reminder acknowledgement and read state.
7. **Run observability** — retain durable scheduler execution history and make failures, partial processing and stale runs visible to administrators.
8. **Channel boundary** — implement in-app delivery first. Keep future SMS, email and browser-push delivery as separate channel adapters with their own attempt records and failure semantics; do not claim or activate external delivery in this work.

### Attendance remains the first producer

Attendance retains ownership of:
- expected-register generation and reconciliation;
- class schedules, academic periods, approved closures and enrollment-date safeguards;
- submission deadlines and configurable reminder delays;
- primary/substitute teacher responsibility snapshots;
- administrator escalation stages;
- cancellation after submission, closure or other stop conditions.

The shared engine owns only recipient notification publication, feed retrieval, read state integration and common delivery observability. Do not move attendance policy into generic notification code.

### Compatibility

- Keep existing announcements and class-post/assignment feed behavior working during the transition.
- Preserve existing read states and avoid reusing source IDs across notification types.
- Preserve the existing attendance reminder destination and transactional acknowledgement behavior.
- Use additive PostgreSQL and SQLite migrations where schema changes are necessary.
- Do not rewrite, delete or backfill existing attendance, announcement, assignment or read-state records without a separately reviewed migration plan.
- No production migration, production data write, cron activation or external provider setup is part of this architecture-plan phase.

## Delivery semantics to standardize

| State | Meaning |
| --- | --- |
| Queued | A recipient-specific notification exists and is waiting for its scheduled time |
| Delivered | It has been published and is available in the recipient's in-app feed |
| Read | The recipient has opened/followed it and the read state is persisted |
| Acknowledged | The workflow explicitly requires confirmation and the recipient confirmed it |
| Cancelled | The source workflow no longer requires delivery |
| Failed | Publication failed and requires observable recovery; do not silently discard it |

Read and acknowledged are distinct. A normal announcement may only need read tracking; an attendance reminder may require acknowledgement as well.

## Implementation phases

### Phase 2J — Shared in-app delivery foundation
- Finalize the additive data model for recipient-specific notification deliveries and idempotency.
- Add PostgreSQL and SQLite migrations and migration-shape tests.
- Add a shared notification delivery service with enqueue, due-dispatch, cancellation and recipient-scoped retrieval.
- Add transaction-safe read-state integration without weakening attendance acknowledgement.
- Add service and database tests for duplicate enqueue, overlapping dispatch, recipient isolation, rollback and migration compatibility.
- Do not yet migrate announcements or assignments to the new pipeline.

### Phase 2K — Attendance integration
- Adapt attendance reminder scheduling to publish due reminders through the shared delivery service.
- Ensure scheduler execution records include generation, scheduling, publication, cancellation, skip and failure counts.
- Remove feed-fetch side effects: opening the notification feed must not itself perform scheduler delivery.
- Preserve reminder escalation and acknowledgement rules.
- Keep old attendance reminder rows readable throughout rollout; no destructive data conversion.

### Phase 2L — Attendance operations and recovery
- Extend the administrator Attendance Operations page with queue health, pending/due/failed delivery counts, oldest pending age and recent delivery failures.
- Provide safe retry/recovery behavior with idempotency and bounded processing.
- Clearly distinguish scheduler execution health from notification delivery health.
- Keep operational views administrator-only and read-only unless a separately reviewed retry action is introduced.

### Phase 2M — Attendance end-to-end verification and activation
- Verify setup readiness, expected-register reconciliation, reminder timing, recipient routing, escalation, cancellation, in-app visibility, read state and acknowledgement.
- Verify catch-up after scheduler downtime and repeated/overlapping invocations.
- Resolve the correct live Vercel project/domain, configure the secret and external minute scheduler, and run a controlled production verification only after explicit approval.
- Do not activate scheduling while the production project/domain and secret configuration remain uncertain.

### Later consumers (not part of attendance completion)
- Announcements: immediate or scheduled publication to selected audiences.
- Assignments: class/section/student-targeted publication and deadline reminders.
- Fees and results: narrowly scoped, permission-aware events.
- External channels: separate opt-in channel adapters, credentials, consent, delivery attempts, retries and cost controls.

## Acceptance criteria for declaring attendance complete

- A due attendance reminder is made available in the correct staff member's in-app feed without relying on feed retrieval to trigger delivery.
- No duplicate notification is created by repeated or concurrent scheduler runs.
- Wrong-school, wrong-recipient and unauthorized users cannot retrieve or acknowledge reminders.
- Teacher responsibility snapshots and administrator escalation remain correct.
- Submitted/closed registers and approved closures stop future reminders and cancel pending deliveries.
- Acknowledgement and read state remain atomic and idempotent.
- Scheduler runs and delivery failures are observable and recoverable.
- SQLite and PostgreSQL tests pass; the production migration is reviewed and manually applied only after approval.
- The production scheduler is activated only after the correct live deployment and secret/scheduler configuration are confirmed.

## Explicit non-goals

- No multi-school product expansion; this remains the Al-Jaleel Academy SIS.
- No SMS, email, WhatsApp or browser-push implementation in the attendance phases.
- No automatic changes to attendance records or analytics policy.
- No bulk migration or deletion of existing notifications/read records.
- No production writes or scheduler activation as part of the initial design phase.
