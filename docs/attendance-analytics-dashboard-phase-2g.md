# Attendance analytics dashboard — Phase 2G

## Dashboard filters

The dashboard is scoped to one school-owned section and an academic session/term. It supports:
- accessible section;
- all accessible classes or one class;
- session and term;
- start and end date.

The date range is clipped to the selected academic period. A maximum range of 366 days is accepted.

## Expected class-days

Expected class-days are calculated from:
- effective-dated class opening schedules (ISO weekdays Monday=1 through Sunday=7);
- the selected section academic period;
- approved school-, section- and class-wide closures.

Pending/rejected/cancelled closure requests do not suppress expected days. Schedule changes preserve historical dates. A closure date is not counted as an expected class-day.

For every expected class-day:
- submitted register = complete;
- expected/in-progress/reopened/closed register = incomplete;
- no register row = missing.

The register completion rate is submitted registers divided by expected class-days. Incomplete and missing registers are not treated as student absences.

## Dashboard metrics and views

- Overall attendance rate across eligible marked student-days, using the shared Present/Late/Leave full-credit rule.
- Expected class-days, submitted registers, incomplete registers and missing registers.
- Class comparison for attendance rate and register completion.
- Daily attendance trend with register status and Present/Late/Absent/Leave counts.
- Low-attendance student list using each class's effective-dated configurable threshold.
- Most late arrivals by student.
- Academy and Tahfeez are never combined.

## Data eligibility

- Register-linked attendance rows are included only after formal submission and only for expected-roster students.
- Legacy rows with no matching register remain reportable.
- Partial saves, reopened registers and unmarked statuses are not converted to Absent.
- Only accessible classes are queried for the signed-in staff member.

## Validation

SQLite and PostgreSQL workflow tests cover:
- effective-dated weekday changes;
- approved section closure suppression;
- expected, submitted, incomplete and missing class-day counts;
- register completion rate;
- section ownership;
- shared attendance rate, Leave credit, low-attendance list and late-arrival trend.

No production migration, production data access/write, merge or deployment is included.
