# Attendance register workflow — Phase 2B

## Scope

This phase connects a generated attendance register to the existing attendance-entry page and adds explicit server-side submission. The existing `attendance` table remains the only store of student/day attendance statuses.

## Entry and roster behaviour

- When the additive register schema is available, opening a class/date sheet attempts idempotent expected-register generation.
- If a register exists, the page uses its immutable expected-student snapshot, not a newly inferred live roster.
- If the foundation schema is not installed or the class/date is not configured for registers, the established attendance sheet remains available.
- A submitted or administratively closed register is read-only. Reopening is a separate administrator workflow and is not included in this phase.
- The status cycle begins with `Not recorded`; it is never converted to Absent by the page or edit action.
- Saving `Not recorded` removes any prior status row. Saving Present, Late, Leave or Absent writes that deliberate status to the existing `attendance` table.

## Save progress

- Register saves validate the actor's school, register state and membership in the snapshotted roster.
- Only an administrator or the responsible teacher snapshotted on the register may save, correct or submit it; subject-assignment access alone is insufficient.
- Submitted/closed registers reject ordinary saves.
- A partial save moves an expected/reopened register to `in_progress`.
- Corrections and unmarking are recorded as register events and per-attendance audit-log rows, including actor and before/after data.
- Legacy sheets without a generated register continue through the established save path, with explicit status validation and unmarking support.

## Submission

`POST /attendance/submit` accepts class ID and date. The server transaction verifies:

1. The register exists and is in an allowed pre-submission state.
2. The submitter belongs to the school.
3. The snapshot is non-empty and its row count equals `expected_student_count`.
4. Every expected student has a persisted Present, Late, Leave or Absent row for the register's class, section, date, session and term.
5. No attendance row exists for a student outside the expected snapshot.

Only then does the transaction set the register to `submitted`, set submitter and timestamps, set submitted count equal to expected count, and append a submitted/resubmitted event. Any validation failure rolls back the transaction.

## Offline behaviour

- Offline Save Progress stores the payload in the existing owner-scoped IndexedDB queue.
- Local queueing is not server submission and does not mark the register submitted.
- The Submit Register action is unavailable offline.
- Submission is blocked while any attendance items remain pending synchronization for the current offline principal.
- After sync, the user can submit while online; the server revalidates every student and status.

## Validation

Run:

```sh
npm run test:attendance-register-workflow
```

SQLite and PostgreSQL workflow-service tests run against isolated databases/schemas and the attendance foundation migration. CI also runs a static UI/offline guard test and the existing regression suite. Full browser-level and end-to-end user-flow tests remain follow-up work.

## Explicit non-goals

- No production migration or production data writes.
- No reopen UI, administrative correction screen or closure approval.
- No reminder scheduler or notification delivery.
- No analytics, reporting or student portal integration.
- No automatic migration of existing attendance records into register snapshots.
