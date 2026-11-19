# Attendance reminder scheduling and escalation — Phase 2E

## Scope

This phase adds idempotent scheduling of attendance reminders, staged administrator escalation, in-app staff delivery, acknowledgement, and a secured scheduler endpoint. It uses the existing `attendance_register_reminders` table; no schema migration is added.

## Timing and stages

- Register deadlines are already snapshotted as UTC instants using the register's `Africa/Lagos` timezone.
- Stage 1 is scheduled at `submission_deadline_at + first_reminder_delay_minutes`; the configured default is zero, so it is due immediately after the deadline.
- Stage 1 goes to the responsible primary/substitute teacher snapshotted on the register.
- If no responsible teacher was snapshotted, stage 1 is routed to same-school administrators as a data-integrity escalation.
- Each item in `subsequent_reminder_intervals_minutes` defines the delay from the previous stage to the next stage. Stages 2 onward go to same-school administrators.
- Administrator recipients are snapshotted when each escalation stage is scheduled.
- A register's stage/recipient uniqueness constraint plus row locking makes repeated or overlapping scheduler calls idempotent.

## Stop conditions and delivery

- Only expected, in-progress and reopened registers are eligible.
- Submitted or administratively closed registers do not receive new reminders.
- Pending reminders are cancelled after server-confirmed submission, administrative closure, or an approved school/section/class closure.
- A reminder is marked sent when the recipient's staff notification feed retrieves it; the notification is delivered inside AcadMe, not by SMS or email.
- Opening a reminder marks it acknowledged and records `acknowledged_at`.
- Delivery is staff-only. Administrators see escalations addressed to them; teachers see reminders addressed to them.
- The notification feed remains compatible with installations where the additive attendance foundation is not yet installed.

## Scheduler endpoint

- `GET /api/cron/attendance-reminders`
- Requires `Authorization: Bearer <CRON_SECRET>` (or `x-cron-secret` for a compatible external scheduler).
- Missing secret returns 503; an invalid secret returns 401.
- Before scheduling reminders, each invocation reconciles missing expected registers for scheduled class days across the current school-local date and the preceding six days. It uses the class schedule, academic period, attendance settings, enrollment dates and approved closures; it does not infer enrollment history.
- The endpoint processes up to 100 missing class/date combinations and schedules up to 100 due registers per invocation. It returns counts only; it does not expose recipient or student data.
- A skipped register (for example, unresolved enrollment dates or no eligible academic period) is not silently converted into an absence or reminder; the skip count is returned for operational review.
- Production must configure `CRON_SECRET` and an external scheduler to invoke this endpoint every minute. This PR deliberately does not add a Vercel cron expression because Vercel Hobby plans do not support sub-daily cron schedules; the account plan/scheduler choice must be confirmed before deployment.
- Scheduler invocations are best-effort and may be repeated; the service is designed to be idempotent and to catch up on overdue stages.

## Validation

SQLite and PostgreSQL workflow tests cover:
- stage 1 at the deadline;
- duplicate scheduler invocation without duplicate reminders;
- delivery to the responsible teacher;
- stage 2 administrator escalation after the configured interval;
- acknowledgement;
- cancellation of queued reminders after submission.

UI checks cover the secured endpoint, bearer-token validation, notification feed integration, acknowledgement, and reminder icon. PostgreSQL tests use a disposable schema with production-shaped mixed ID widths, not a full production clone.

## Safety boundary

This is a stacked draft PR based on Phase 2D. No production migration, production data access/write, merge, deployment, or live scheduler activation is included.
