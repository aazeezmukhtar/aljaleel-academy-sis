# Shared attendance analytics engine

## Scope

`services/attendanceAnalyticsService.js` is a read-only, student-level calculation service. It is deliberately not connected to the attendance dashboard, reports, or student portal in this phase.

API:

```js
const result = await require('../services/attendanceAnalyticsService').calculate({
  schoolId,
  sectionId,
  classId,
  studentId,
  session,
  term,
  startDate,
  endDate,
  lowAttendanceThreshold
});
```

The threshold is supplied by the caller and must be a number from 0 to 100. Later report and portal integration must obtain the same configured threshold from the school's settings and pass it to this shared engine; do not duplicate calculation logic or hard-code separate portal/report thresholds.

## Calculation rules

1. The expected-day service determines term boundaries, effective-dated class opening days, closures and confirmed dated student placements.
2. Only dates classified as expected are considered eligible class days.
3. A date enters the attendance-rate denominator only when its formal register is submitted and a corresponding student attendance row exists with a recognized status.
4. Present, Late and Leave each receive one attendance credit. Absent receives zero.
5. Draft registers, missing registers, submitted registers with no student row, and unknown statuses are reported separately and excluded from the rate. They are never silently treated as absence.
6. Closed, non-opening, outside-term, outside-enrollment and unknown dates remain visible in the day-level result but do not enter the denominator.
7. The low-attendance flag is true only when a calculable rate is strictly below the supplied threshold.
8. Every query is scoped by school, section, class, student, session and term. Academy and Tahfeez results are never combined.
9. Attendance dates come from the attendance date and formal register date, never from created/updated timestamps.
10. The service does not write data, alter submitted registers, infer historical enrollment dates, send reminders, or mutate settings.

## Leave approval caveat

The current attendance status model exposes `Leave` but does not expose a separate leave-approval flag. In accordance with the approved policy, this engine currently treats every `Leave` status as approved leave and grants full credit. If the school later distinguishes pending/unapproved leave from approved leave, that distinction must be represented explicitly before changing this calculation.

## Denominator and missing-register interpretation

`counts.expected` is the number of expected class days within the confirmed student placement, including dates whose register is missing, draft, or incomplete.

`counts.recorded` is the denominator used for `attendanceRate`: expected days with a submitted register and a corresponding recognized attendance row.

`counts.missingRegister`, `counts.draftRegister`, `counts.missingStudentRecord`, and `counts.unknownAttendanceStatus` remain separately visible. Missing or draft registers do not count as absence and do not reduce the attendance rate.

## Disposable tests

- SQLite: `node tests/attendance-analytics-service.test.js`
- PostgreSQL 17.6: `PG_TEST_URL=<disposable-postgres-url> node tests/attendance-analytics-postgres.test.js`

The PostgreSQL test refuses to fall back to `DATABASE_URL` and creates/drops an isolated schema. Never point `PG_TEST_URL` at production.

No migration is introduced by this phase. The service depends on the manually installed attendance calendar, dated enrollment, attendance, and formal register foundations. No migration is applied automatically or to production.
