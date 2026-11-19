# Shared attendance analytics and student portal consistency — Phase 2F

## Shared status rules

All attendance summaries use one shared calculation engine:

- Present: 1 attendance credit.
- Late: 1 attendance credit.
- Leave: 1 attendance credit; marking Leave is the approval decision.
- Absent: 0 attendance credit.
- Unmarked/invalid status: excluded from the calculation; it is never converted to Absent.

`attendanceRate = (Present + Late + Leave) / marked eligible days × 100`

The service also returns absence rate, late rate, total marked days, attended days, and whether the configurable class threshold is breached.

## Register-aware eligibility

When the additive attendance-register foundation is available:
- Attendance rows for a register contribute only after that register is formally submitted.
- Partial saves, expected registers and reopened registers are excluded from final attendance analytics until resubmission.
- A submitted register contributes only for students in its expected-roster snapshot.
- Approved school-, section- or class-wide closures do not create an attendance denominator because they suppress expected registers.
- Historical attendance rows that predate register tracking remain reportable when no register exists for their class/section/date.

When the foundation is not installed, the service falls back to existing attendance rows, preserving current application compatibility.

## Section isolation

- Administrative reports are filtered by the class's owning section and school.
- Student portal attendance is selected by section; Academy and Tahfeez are never combined into one attendance percentage.
- Session and term choices are derived from the selected section's eligible records.
- Portal navigation preserves the selected section across term, status, history and calendar filters.

## Integrated views

- The existing administrative class report now uses the shared engine and the effective-dated class threshold.
- The report displays generated-register submission coverage separately from student attendance rate.
- The student portal uses the same records and calculation function, includes Leave as attended, and displays the applicable class threshold.
- The portal now has a Leave history filter.

## Deliberate boundary for the next analytics phase

The register-completion figure in this phase is the proportion of generated registers that were submitted. It is not yet the complete count of every expected class day in a date range. The next dashboard phase must calculate expected class-days directly from effective-dated class schedules, academic periods, approved closures and section context, so missing register days are visible even before a register row exists.

This phase does not yet add overview dashboards, class comparisons, daily summaries, trends, or a dedicated low-attendance student list.

## Validation

SQLite and PostgreSQL workflow tests cover:
- Present/Late/Leave full credit and Absent zero credit;
- below-threshold classification;
- exclusion of partial/in-progress register rows;
- inclusion of legacy attendance rows without a register;
- Academy/Tahfeez section isolation;
- generated/submitted/pending register counts;
- student portal and administrative report wiring.

No production migration, production data access/write, merge or deployment is included.
