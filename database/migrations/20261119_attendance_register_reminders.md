# Attendance register reminders

Manual, additive migration for in-app reminders to the explicitly assigned register holder.

## Behavior
- A reminder is created only for a date classified as `expected` by `expectedAttendanceDaysService`.
- The class must have an effective-dated register responsibility assignment for that date.
- A formally submitted register is never reminded. A missing or still-open/draft register is eligible.
- Reminders are generated when an authenticated staff member loads the notification feed. This is request-driven and does not require a background scheduler or cron process.
- The service checks the active section session/term and scans the current term's past expected days through yesterday. This catches up if the responsible staff member did not open the app on the first day after a missed register.
- One reminder row is created per school/section/class/date/session/term. Repeated notification requests do not duplicate it.
- Reminders remain visible to the responsible staff member until the register is formally submitted. Submission resolves the reminder in the same database transaction.
- The existing notification read table is used for read state. Marking a reminder read does not resolve the underlying missing register.
- No SMS, email, WhatsApp, or external notification is sent.

## Important boundaries
- No reminder is created for non-opening days, closures, unknown schedules, unknown academic periods, or dates without an explicit responsible staff assignment.
- Reminders are staff-only and are scoped to exact school, class, section, staff, session and term.
- The first notification-feed request after the due date performs the catch-up. There is no scheduled job.
- Apply after the attendance calendar and register submission migrations.
