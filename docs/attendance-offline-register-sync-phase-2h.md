# Attendance offline register synchronization safety — Phase 2H

## Offline save semantics

- Attendance form saves made without a working network are written to the account-scoped IndexedDB `attendance_sync` queue.
- Each queued item retains class, date, academic context and the full submitted attendance snapshot, plus local owner and saved-at metadata.
- Local metadata is stripped before the request is sent to `POST /attendance/save`.
- Queue records are deleted only after the server responds with HTTP success and JSON `success: true`.
- Redirects, HTTP conflicts, validation failures, server errors and network errors remain queued for review/retry.
- Repeated snapshots are applied in queue order; the server workflow records audit events only for actual changes.

## Submission boundary

- Offline mode never submits a register.
- The client blocks submission while offline.
- Before online submission, the client checks the current account's attendance queue; any pending item or unreadable queue blocks submission.
- The server independently verifies register status, school/section ownership, roster snapshot count, every expected student's deliberate valid status, and absence of out-of-roster attendance records.
- Therefore, a client-side check cannot bypass server-side completeness.

## Recovery improvements

- An unreadable attendance queue fails closed for register submission.
- General pending-queue reads no longer report zero when IndexedDB cannot be read.
- The sync indicator shows a warning when queue state is unreadable.
- Staff can manually retry pending sync from the sync indicator while online.
- The existing account-owner isolation and seven-day offline retention remain unchanged.

## Validation

The new offline register sync test checks:
- offline queue owner requirement and IndexedDB transaction completion;
- account-scoped pending count and fail-closed queue-read behavior;
- metadata removal before sync;
- queue deletion only after server-confirmed success;
- conflicts/validation failures remaining queued;
- offline and pending-queue submission blocks;
- independent server-side roster and status validation.

The existing offline cache and sync-recovery tests are now included in the regression workflow. No database migration is added.
