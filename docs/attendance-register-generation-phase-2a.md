# Attendance register generation service — Phase 2A

## Scope

This phase introduces the server-side service that generates one expected attendance register for a class, section and school-local date. It is deliberately not connected to an HTTP route, background scheduler, attendance form, reminders, analytics or student portal yet.

The service is additive. It does not write to or modify the existing `attendance` table.

## Generation rules

For a requested class and date, generation proceeds in this order:

1. Verify the class and section belong to the supplied school.
2. Resolve exactly one section academic period covering the date.
3. Resolve exactly one effective class schedule for the date's ISO weekday (Monday=1 … Sunday=7).
4. Skip generation when an approved school-, section- or class-level closure covers the date.
5. Resolve exactly one effective class attendance settings row.
6. Resolve the active responsible teacher. An active substitute takes precedence over the primary teacher; ambiguous multiple active primary/substitute rows stop generation.
7. Snapshot students whose dated enrollment period covers the date and matches the academic period's session, school, class and section.
8. Refuse generation when any matching enrollment period is marked `review_needed`, or when overlapping periods would place one student on the roster more than once.
9. Calculate and snapshot the submission deadline using `Africa/Lagos`, converting the configured local `HH:MM` deadline to UTC.
10. Insert the register, roster snapshot and `generated` event in one transaction.

Generation is idempotent for the database key `(class_id, section_id, register_date)`. A repeated call returns the existing register and does not replace its original roster snapshot.

An empty roster can be generated but is explicitly returned with `empty_roster_requires_review`; later submission logic must prevent an empty roster from being silently submitted.

## API

```js
const {
  generateExpectedRegister,
  generateExpectedRegistersForDate
} = require('../services/attendanceRegisterGenerationService');

await generateExpectedRegister({
  schoolId,
  classId,
  registerDate: 'YYYY-MM-DD',
  generatedBy: staffId // optional for scheduled/system generation
});

await generateExpectedRegistersForDate({
  schoolId,
  registerDate: 'YYYY-MM-DD',
  generatedBy: staffId
});
```

The module also exports `createAttendanceRegisterService(dbAdapter)` for isolated tests. The injected adapter must expose the same `all`, `get`, `run` and `transaction` methods as `utils/db`.

## Explicit non-goals

- No production migration or production data write.
- No scheduler or automatic daily job.
- No route or user-interface changes.
- No attendance status writes.
- No submission, reopening, correction, closure approval or reminder delivery.
- No analytics or student portal changes.
- No inferred/backfilled enrollment dates.
- No automatic correction of overlapping schedule, responsibility, setting, academic-period or enrollment intervals.

## Validation

Run both disposable-database tests:

```sh
npm run test:attendance-register-generation
PG_TEST_URL='postgres://...disposable-test-db...' npm run test:attendance-register-generation-postgres
```

The SQLite test uses an in-memory database. The PostgreSQL test uses a disposable schema and a production-shaped mixed ID-width fixture. CI runs both alongside the existing migration and regression suites. These tests validate the service's database behaviour in both engines, but do not provide end-to-end workflow coverage.

## Next phase

The next application slice should expose register generation to an administrator-only reconciliation command/page, then add register retrieval and the transactional attendance submission path. Existing attendance status writes must remain the authoritative source for Present, Late, Leave and Absent.
