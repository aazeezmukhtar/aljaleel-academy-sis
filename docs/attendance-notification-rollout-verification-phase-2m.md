# Attendance notification rollout verification — Phase 2M

## Purpose

This phase closes the operational gap between the merged attendance reminder implementation and safe production activation. It is a runbook and verification gate, not an instruction to activate immediately.

The shared notification path is opt-in. It is used only when both conditions are true:

- the additive `notification_deliveries` migration is installed; and
- `ATTENDANCE_REMINDER_SCHEDULER_DELIVERY=true` is configured for the live application.

Until both are true, the compatibility delivery path remains active. Do not enable the flag merely because the application deployment is ready.

## Known deployment boundary

The repository is `aazeezmukhtar/aljaleel-academy-sis`. The Vercel project linked to it is `aljaleel-academy-sis`; do not substitute the separate `acadme-sis` Vercel project.

Before activation, an administrator must confirm in the Vercel dashboard that the Production deployment and the domain staff actually use both point to this repository/project. A READY deployment alone does not prove that it is the domain used by the school.

The project is on Vercel Hobby. Do not rely on a Vercel cron expression for a one-minute schedule. Use an independently managed external scheduler after the endpoint and secret are verified.

## Gate 0 — production change freeze

Before running this checklist:

- Do not enable `ATTENDANCE_REMINDER_SCHEDULER_DELIVERY`.
- Do not configure or expose `CRON_SECRET` until the correct Production project/domain is confirmed.
- Do not invoke the scheduler endpoint against production until its secret is configured and the owner approves a controlled test.
- Do not apply migrations from a preview deployment or to a database whose identity has not been verified.
- Never put the cron secret in a URL, query string, source file, issue, log, or chat.

## Gate 1 — verify the target

In Vercel, confirm all of the following:

1. Project name is `aljaleel-academy-sis`.
2. Git repository is `aazeezmukhtar/aljaleel-academy-sis`.
3. The Production deployment is READY and its commit is the expected `master` commit.
4. The school-facing domain is assigned to this project and routes to that Production deployment.
5. The Production environment is the one backed by the intended AcadMe Supabase/PostgreSQL database.

If any item is unclear, stop. Do not use the similarly named `acadme-sis` project as a substitute.

## Gate 2 — read-only database preflight

Run these queries in the Supabase SQL editor only after confirming the selected database is AcadMe Production. They are read-only.

```sql
SELECT
  to_regclass('public.attendance_registers') AS attendance_registers,
  to_regclass('public.attendance_scheduler_runs') AS attendance_scheduler_runs,
  to_regclass('public.notification_deliveries') AS notification_deliveries,
  to_regclass('public.attendance_register_reminders') AS attendance_register_reminders;
```

Expected before the shared queue migration is applied:

- attendance foundation tables are present;
- `attendance_scheduler_runs` is present;
- `notification_deliveries` may be absent and must be treated as a rollout blocker.

After the migration is deliberately applied, verify the shared queue table and its indexes:

```sql
SELECT to_regclass('public.notification_deliveries') AS notification_deliveries;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'notification_deliveries'
ORDER BY indexname;
```

Do not infer that a migration ran from application behavior or a successful deployment. Keep the query output as the migration evidence. Applying the migration is a separate, explicitly approved production change; it is additive and does not backfill legacy announcements or class posts.

## Gate 3 — configure the scheduler credential

Only after Gate 1 is satisfied:

1. Generate a strong random secret in a password manager or trusted secret generator.
2. Add it to the confirmed Vercel Production project as a sensitive Production-only environment variable named `CRON_SECRET`.
3. Do not paste the value into GitHub, this repository, this conversation, or an external scheduler's URL.
4. Redeploy the Production application so the runtime receives the variable.
5. Confirm that a request without a credential is rejected and that a request with an incorrect credential is rejected. Do not use the real secret in shared logs.

The endpoint is:

```text
GET https://aljaleel-academy-sis.vercel.app/api/cron/attendance-reminders
Authorization: Bearer <secret>
```

Use the school's confirmed Production domain instead of the project domain if the school-facing domain is different.

Expected authentication behavior:

- missing secret configuration: HTTP 503;
- missing request credential: HTTP 401;
- incorrect credential: HTTP 401;
- valid credential: scheduler execution response with aggregate counts only.

A valid request can generate expected register records and reminders. Therefore, do not use it as an exploratory health check or run it until the school has approved a controlled production test.

## Gate 4 — external minute scheduler

Because the Vercel project is on Hobby, configure an external scheduler to call the endpoint once per minute. Provider selection and configuration are a separate operational decision.

The external scheduler must:

- use HTTPS;
- send `Authorization: Bearer <secret>` as a header;
- keep the secret encrypted in the provider's secret store;
- call only the confirmed Production domain;
- record HTTP status and execution time without recording the secret or response bodies containing sensitive data;
- avoid aggressive overlapping retries. The endpoint is designed to tolerate repeated/overlapping invocations, but the provider should still use a sensible timeout and retry policy.

Do not create a second independent scheduler until the first one is verified. Do not configure a public unauthenticated URL.

## Gate 5 — controlled verification before queue mode

With the queue migration installed, `CRON_SECRET` deployed, and the external scheduler configured:

1. Run one approved controlled scheduler invocation.
2. Confirm a new `attendance_scheduler_runs` row reaches `succeeded` and has a completion timestamp.
3. Confirm the operations dashboard reports scheduler health separately from notification delivery health.
4. Confirm the scheduler summary reports `deliveryMode=legacy_scheduler` while the feature flag is still disabled.
5. Verify that the run did not create duplicate reminder stages when invoked again for the same test window.
6. Verify the expected reminder recipient is the register's snapshotted responsible staff member; escalation recipients must be same-school administrators.
7. Verify a submitted/closed register or approved closure cancels still-queued reminders.
8. Verify staff can see and acknowledge their own reminder, and another staff account cannot read or acknowledge it.
9. Review missing-register skips and failures; do not convert unresolved enrollment dates into absences.

Use a controlled test class/date with the school administrator. Do not fabricate test attendance in live classes or alter real student attendance to exercise the scheduler.

## Gate 6 — enable shared queue delivery

Only after Gates 1–5 pass:

1. Confirm `notification_deliveries` exists in the same Production database used by the confirmed live project.
2. Confirm the external minute scheduler is invoking the secured endpoint successfully.
3. Confirm recent scheduler runs are succeeding and no unexpected queue backlog or failure exists.
4. Add `ATTENDANCE_REMINDER_SCHEDULER_DELIVERY=true` to the confirmed Vercel Production project.
5. Redeploy.
6. Verify the scheduler reports `deliveryMode=shared_queue`.
7. Verify due reminders become `delivered` in the shared queue and corresponding legacy reminder rows synchronize to `sent`.
8. Verify the staff notification feed is read-only for attendance reminders: refreshing it must not dispatch or change delivery state.
9. Verify read/acknowledgement updates the shared delivery, legacy reminder and read-state records atomically.
10. Verify submitted/closed registers cancel future queued stages and that delivered notifications remain visible historically.

If any verification fails, stop the rollout. Do not toggle between modes repeatedly as a substitute for diagnosing the failure. Preserve queue rows and scheduler history for investigation.

## Rollback boundary

If shared queue mode causes a verified issue, an administrator may disable `ATTENDANCE_REMINDER_SCHEDULER_DELIVERY` in the confirmed Production project and redeploy, returning the application to compatibility mode. Do not delete queue rows or reverse the additive migration. Keep the external scheduler running only if the compatibility scheduler path is intentionally being used and has been verified; otherwise pause it deliberately and record the reason.

A rollback must not change attendance records, register submissions, enrollment history or existing reminder history.

## Completion evidence

Do not mark attendance notifications production-ready until all of the following are recorded:

- confirmed Vercel project, Git repository, Production deployment and school-facing domain;
- confirmed Production database identity;
- read-only migration preflight output and post-migration verification output;
- credential configured without exposing its value;
- external scheduler provider, interval and last successful execution;
- successful scheduler run history;
- successful legacy-mode controlled test;
- successful shared-queue-mode test;
- recipient isolation, read-only feed, atomic acknowledgement and cancellation checks;
- no unexplained failures or backlog.

## Explicitly out of scope

- Announcement, assignment, fee or result notification migration.
- SMS, email, WhatsApp or browser push.
- Automatic retry/replay of failed deliveries.
- Parent notifications.
- Production migration application, environment changes or scheduler activation by this documentation change.
