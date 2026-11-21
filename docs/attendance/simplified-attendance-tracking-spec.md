# Simplified Attendance Tracking Specification

Status: proposed implementation specification
Scope: initial simplified attendance workflow for Al-Jaleel Academy
Production changes: none

## 1. Product objective

Replace the schedule-configuration-oriented attendance setup experience with a simple attendance tracking workflow that reflects the school's actual operating practice.

Attendance continues to be recorded against the existing academic session and term context. A class is not presumed to have opened merely because a weekday has arrived.

## 2. Core operating rule

- When attendance has been recorded for a class on a date in the selected session and term, the tracking page reports that attendance was recorded.
- When no attendance rows exist for that class/date/session/term, the page reports **No attendance recorded**.
- No attendance recorded must not be presented as proof that the class was closed or was expected to open.
- An administrator who knows that the class opened but attendance was not recorded may manually ping the responsible class teacher.
- No weekday schedule, expected-register generation, automatic missing-register discovery, or automatic reminder is required for this initial workflow.

The existing attendance table remains the source of truth for the tracking status. Where useful, the page may show recorded-student count alongside the status; it must not silently treat a partial save as a completed register.

## 3. Academic context

Attendance records remain associated with their existing `session` and `term` values.

- The tracking page must make the date and academic context visible.
- Academy and Tahfeez may have different current session/term values at the same time.
- The implementation must not assume one school-wide session/term applies to every section.
- For a selected section, its configured current session and term may be used as the default context.
- Historical tracking must use an explicitly selected session/term context or a reliable existing academic-period source; it must not relabel historical attendance using today's section settings.
- Attendance marking must preserve the established class/section/session/term ownership rules and existing attendance history.

## 4. Administrative tracking page

Provide a dedicated attendance tracking page for administrators.

Expected capabilities:
- Select a date (default to the school's local date, Africa/Lagos).
- Select a section and its session/term context, or view sections grouped with their own academic contexts.
- List the classes belonging to the selected section/context.
- Show each class as **Recorded** or **No attendance recorded** for that date and context.
- Show useful counts (recorded students and, if already available safely, active/enrolled roster size) without changing the status semantics.
- Provide a **Ping class teacher** action only when no attendance is recorded and an eligible administrative class assignee exists.
- Show whether a ping has already been sent, when it was sent, and its recipient(s), using existing notification delivery history.
- Do not add schedule setup forms or require administrators to configure every class.

The page is an attendance activity tracker, not a declaration of which classes were expected to open.

## 5. Teacher attendance access

Only administrative responsibility for a class grants permission to mark attendance.

The accepted sources of administrative responsibility are:

1. `classes.form_teacher_id` matching the signed-in staff member.
2. A `class_assignments` row matching the staff member, class, and the class section's applicable current session.

These sources are treated as an OR relationship. Duplicate matches must not duplicate classes.

The following must never grant attendance-marking permission by themselves:
- `subject_assignments`
- Teaching a subject in a class
- Academic/reporting access to a class
- Student, result, fee, or other unrelated class visibility

Apply this rule server-side to:
- Attendance class selection.
- GET attendance marking form.
- Previous-day attendance view.
- POST attendance save.
- Register save/submit handlers if they remain reachable.
- Any other attendance write or correction endpoint.

Hiding a class in the UI is not sufficient. Direct URL and forged POST requests must be rejected.

Administrators retain their existing school-wide attendance access.

## 6. Manual in-app ping

Initial channel: in-app notification only. No WhatsApp, SMS, email, or external messaging.

- The ping is initiated manually by an authorized administrator from the tracking page.
- Recipients are the class's eligible administrative assignees: the current `form_teacher_id` and/or matching session-specific `class_assignments` staff. Deduplicate recipients.
- Subject-only teachers must never receive a class-opening ping merely because they teach a subject in that class.
- Notification content identifies the class, date, session, and term, and asks the responsible teacher to record attendance if the class opened.
- Use the existing shared notification-delivery service and its in-app channel.
- Record actor, recipients, class/date/session/term source context and delivery status through existing notification/audit facilities where available.
- Repeated clicks must not create duplicate notifications for the same recipient and class/date/session/term. The UI should show the existing ping rather than imply another notification was sent.
- The notification destination should open the relevant attendance marking flow for that class and date.
- No automatic pings or background reminder schedule in this phase.

If the existing in-app notification foundation is unavailable, the action must fail clearly and safely; it must not claim a ping was sent.

## 7. Simplification and scope boundaries

For this phase:
- Do not require or seed section-global attendance schedules.
- Do not require or seed class-specific weekday overrides.
- Do not use weekday schedules to decide whether attendance can be recorded.
- Do not automatically generate expected attendance registers.
- Do not automatically ping classes with no attendance.
- Do not require the newer class attendance setup tables for the basic attendance workflow.
- Do not delete schedule, register, closure, analytics, or other existing code/tables as part of this feature. Treat them as deferred/legacy capabilities and isolate them from the simplified workflow where needed.
- Do not run production migrations or modify production data as part of implementation.
- Do not change the existing attendance record schema unless a separately reviewed, strictly necessary migration is identified.

The existing attendance table and academic session/term fields remain the initial source of truth.

## 8. Security and integrity requirements

- Every query and action is scoped to the authenticated user's school.
- Validate class, section, session, term, date and recipient ownership server-side.
- Validate that a non-admin actor has administrative responsibility for the selected class in the applicable session.
- Validate ping recipients from the same administrative-responsibility rule; never accept recipient IDs from the browser as authority.
- Prevent pings for classes with attendance already recorded in the selected context, unless a later explicit correction workflow is approved.
- Make ping creation idempotent per recipient and class/date/session/term.
- Log the administrator who initiated each ping.
- Preserve existing attendance history and do not reinterpret missing records as absence or closure.

## 9. Acceptance tests

1. A class with attendance rows for the selected date/session/term is shown as Recorded.
2. A class with no matching attendance rows is shown as No attendance recorded, not Closed or Expected.
3. Academy and Tahfeez can be displayed with their own session/term contexts.
4. Historical attendance is queried using its original session and term, not today's context.
5. A form teacher can open, save and view attendance for the class.
6. A staff member with a matching session-specific class assignment can open, save and view attendance for that class.
7. A subject-only teacher cannot see the class in the marking selector.
8. A subject-only teacher is rejected on direct GET, POST save, previous-day, and register write routes.
9. A teacher assigned administratively to one class and academically to other classes sees only the administratively assigned class(es).
10. Admin retains existing school-wide access.
11. An administrator can manually ping eligible administrative assignees when no attendance is recorded.
12. Subject-only teachers are not ping recipients.
13. Duplicate pings for the same recipient and class/date/session/term are prevented and the prior ping is displayed.
14. If notification delivery is unavailable, the UI reports failure and does not claim success.
15. No schedule configuration, schedule-based expected-register generation, automatic reminder, or production migration is required for the simplified workflow.

## 10. Delivery plan

### Phase A — specification and read-only audit
- Confirm current attendance data flow, academic context, class assignment semantics, notification availability and existing audit facilities.
- Review this specification before implementation.

### Phase B — server-side permission correction
- Centralize the administrative-class authorization rule.
- Remove subject-assignment-derived access from all attendance read/write paths.
- Add focused controller/service tests for allowed and denied access.

### Phase C — tracking page and manual ping
- Add the administrative tracking route and view.
- Add status queries against existing attendance records and their session/term context.
- Add manual in-app ping using the existing notification delivery service.
- Add idempotency, audit/history display and notification failure handling.

### Phase D — verification and review
- Run focused tests and relevant regression tests.
- Inspect the full diff and production compatibility.
- Open a pull request for review. Do not merge or execute production SQL without the user's separate approval.
