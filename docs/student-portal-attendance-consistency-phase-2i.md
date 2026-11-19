# Student portal attendance consistency — Phase 2I

## Dashboard calculation

The student dashboard now obtains attendance through the shared `attendanceAnalyticsService`, the same service used by the dedicated `/portal/attendance` page.

For each enrolled section/session/term context, the dashboard:
- fetches records using the student's own ID, school ID and section ID;
- applies the shared submitted-register eligibility rule;
- counts Present, Late and approved Leave as full attendance credit;
- counts Absent as zero credit;
- excludes unmarked, partial, reopened and otherwise unsubmitted register data;
- retains legacy attendance records only where no register exists for that class/date.

## Section separation

Academy and Tahfeez summaries are displayed independently. The dashboard no longer combines records across sections or uses broad independent session/term IN lists that could mix unrelated section contexts.

## Presentation

- A single section displays its own attendance percentage and attended/total days.
- Multiple sections display one separate percentage per section.
- No available eligible attendance records display as an em dash rather than a misleading zero.

## Validation

The section-owned portal regression test asserts that the dashboard uses the shared analytics service, passes section/session/term context, calculates the shared summary, and does not query the raw attendance table for a combined percentage.

No schema migration is added. No production database access/write, merge or deployment is included.
