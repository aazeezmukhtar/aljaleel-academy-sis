# Attendance closure requests and approval — Phase 2D

## Scope

This phase adds the application workflow for requesting, reviewing, approving, rejecting and cancelling attendance closures. It uses the existing `class_attendance_closures` table; no new migration is introduced.

## Request rules

- A staff member must belong to the same school as the requested closure.
- Administrators may request school-wide, section-wide or class-specific closures.
- Non-administrators may request only a class-specific closure, and only when they are the responsible primary/substitute class teacher for the entire requested date range.
- The selected scope must belong to the school. A class closure always snapshots its owning section.
- Start and end dates are valid calendar dates; end cannot precede start.
- A non-empty reason of at most 500 characters is mandatory.
- Pending and approved closures cannot overlap another pending/approved closure whose scope intersects (school intersects all, section intersects its classes, class intersects only itself).

## Decision and cancellation rules

- Only a same-school administrator may approve or reject a pending request.
- Rejection requires a reason; approval records the administrator and timestamp.
- Approval rechecks overlapping approved closures transactionally.
- Only the requester or an administrator may cancel a pending request.
- Decisions and cancellations are written to `attendance_foundation_audit_logs`.
- Pending requests do not suppress attendance. Only approved closures are honored by register generation, attendance saving and submission.

## Interface

- Attendance sheets link to the closure management page.
- Staff can submit requests within their permitted scope.
- Administrators can review and approve/reject pending requests.
- Requesters and administrators can cancel pending requests.
- The server rechecks authorization and scope; client-side visibility is not treated as security.

## Validation

SQLite and PostgreSQL workflow tests cover:
- responsible teacher request;
- same-school administrator approval;
- non-administrator decision rejection;
- rejection reason requirement;
- scope-overlap conflict rejection;
- cancellation by requester;
- closure audit history.

The attendance UI guard test checks the management routes, page, and attendance-sheet entry point. PostgreSQL uses a disposable schema and the production-shaped mixed ID-width fixture; this is not a full production clone.

## Safety boundary

This is a stacked draft PR based on the administrator reopening phase. No production migration, production data access/write, merge, or deployment is included.
