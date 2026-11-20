# Attendance Section Defaults and Class Overrides

**Status:** Approved requirements; specification only  
**Scope:** AcadMe attendance setup and register scheduling for Al-Jaleel Academy  
**Production data changes:** None  
**Implementation status:** Not started

## 1. Confirmed school configuration

The school uses section-level weekly opening-day defaults. A class inherits its section's default unless an effective class-specific override exists.

| Scope | Opening days |
|---|---|
| Academy section (section ID 1) | Monday, Tuesday, Wednesday, Thursday, Friday |
| Tahfeez section (section ID 2) | Saturday, Sunday, Monday, Tuesday, Wednesday |
| Tahfeez — F 2 | Thursday, Friday, Saturday, Sunday |
| Tahfeez — F3 A | Thursday, Friday, Saturday, Sunday |
| Tahfeez — F3 B | Thursday, Friday, Saturday, Sunday |
| Tahfeez — F 4 | Thursday, Friday, Saturday, Sunday |

Weekday numbering follows the existing application convention: Monday = 1 through Sunday = 7.

All other classes inherit their section's default. The four named Tahfeez classes are full weekly overrides, not additions to the Tahfeez default.

### Confirmed academic periods

| Section | Session | Term | Start date | End date |
|---|---|---|---|---|
| Academy | 2026/2027 | 1st Term | 2026-09-07 | 2026-12-28 |
| Tahfeez | 2026/2027 | 3rd Term | 2026-09-19 | 2027-02-05 |

These dates are approved configuration inputs only. They must not be inserted by this specification change.

## 2. Goals

1. Configure one weekly schedule for each section.
2. Allow a class to replace its section schedule with a complete class-specific weekly schedule.
3. Preserve schedule history using effective dates; never overwrite historical configuration.
4. Resolve one authoritative effective schedule for every class and date.
5. Use the same resolver in setup readiness, register generation, operations reporting, attendance analytics, and any student-facing attendance calculations that depend on expected school days.
6. Avoid requiring duplicate schedule rows for every class.
7. Keep teacher responsibilities and attendance settings class-specific; this change does not make them section-wide.

## 3. Schedule resolution rules

For a given school, class, and local calendar date:

1. Find the effective class-scoped schedule set for that class and date.
2. If exactly one exists, use all weekdays in that set. Do not merge it with section weekdays.
3. Otherwise, find the effective section-scoped schedule set for the class's section and date.
4. Use all weekdays in the section set.
5. If neither exists, the class has no configured schedule for that date and is not ready.
6. More than one effective set at the same scope is a configuration conflict. Fail closed: do not generate a register and surface the conflict to an administrator.

A date is an expected school day only if its weekday is included in the resolved set. Class closures and approved non-school dates continue to take precedence according to the existing closure rules.

All date comparisons and "today" calculations use Africa/Lagos.

## 4. Effective-date and history rules

- Schedule sets have inclusive `effective_from` and optional inclusive `effective_to` dates.
- A new schedule must not overlap another schedule set at the same scope and for the same section/class.
- To change a schedule, end the previous set on the day before the new set begins, then create a new set. Do not edit or delete the old set.
- A class override applies only for its own effective date range. Before and after that range, the class inherits the effective section default.
- Section changes affect inheriting classes only; an active class override remains authoritative.
- A schedule set contains its complete weekly weekday list. An empty set is invalid.
- Creation and ending actions must be transactional and audit logged.
- Do not backdate a schedule in a way that changes the expected-day interpretation of already generated registers without an explicit, separately designed correction workflow.

## 5. Data model proposal

Introduce a normalized schedule-set model rather than treating individual weekday rows as independent overrides:

### `attendance_schedule_sets`

- `id` BIGSERIAL primary key
- `school_id` INTEGER FK to schools
- `section_id` INTEGER FK to sections
- `class_id` nullable INTEGER FK to classes
- `scope_type` constrained to `section` or `class`
- `effective_from` DATE
- `effective_to` nullable DATE
- `created_by` nullable staff FK
- `created_at` timestamp
- Check: section scope requires null class_id; class scope requires non-null class_id
- Check: effective_to is null or not earlier than effective_from

### `attendance_schedule_days`

- `id` BIGSERIAL primary key
- `schedule_set_id` BIGINT FK to attendance_schedule_sets with RESTRICT
- `weekday` SMALLINT constrained to 1–7
- Unique (`schedule_set_id`, `weekday`)

The service must validate school/section/class ownership, non-empty weekday lists, duplicate weekdays, and same-scope effective-date overlap transactionally. Serialize configuration writes using the existing school-row lock pattern.

### Register history compatibility

The current `attendance_registers.schedule_id` points to `class_attendance_schedules` and is NOT NULL. Preserve that legacy relationship and its referenced rows.

Add nullable `attendance_registers.schedule_set_id` referencing `attendance_schedule_sets`. Make the legacy `schedule_id` nullable and add a check requiring exactly one of `schedule_id` or `schedule_set_id` to be non-null. Existing historical rows remain attached to their original legacy schedule rows; newly generated registers reference the resolved schedule set. Do not drop or repurpose `class_attendance_schedules`.

This avoids a polymorphic foreign key and preserves the exact schedule configuration used by each generated register.

## 6. Setup interface

Replace the current class-only opening-day form with two clear configuration areas:

### Section default schedules
- Select section.
- Select one or more weekdays.
- Effective-from and optional effective-to dates.
- Display current and historical section schedule sets with their weekdays and date ranges.
- Allow ending an active set; do not provide edit/delete actions.

### Class-specific overrides
- Select section, then class filtered to that section.
- Select the complete weekly weekday list for that class.
- Effective-from and optional effective-to dates.
- Clearly label the schedule as a full replacement of the section default during its effective period.
- Display inherited versus overridden status for each class and show the resolved weekdays.
- Allow ending an active override so the class returns to inheriting the section default from the next applicable date.

The interface must explain that classes without an active override inherit their section schedule. It must not ask administrators to configure the same weekdays separately for every class.

## 7. Readiness dashboard

For each class, resolve the effective schedule for the readiness date using the same shared resolver used by generation.

- Section default is sufficient for every class in that section unless a class override is active.
- Show the resolved source: section default or class override.
- Show the actual resolved weekdays.
- Missing section schedule means missing opening days for inheriting classes.
- An invalid/overlapping effective schedule is a configuration error, not merely a missing schedule.
- Continue validating academic period, class attendance settings, and primary teacher as before.
- Do not require section-wide teacher responsibilities or settings.

## 8. Register generation and downstream consumers

- Register generation must resolve schedule sets by class and register date.
- Generate a register only when the resolved weekday list includes that date's weekday and the date is within the active section academic period and not excluded by an approved closure.
- Store the selected schedule_set_id on each new register so historical registers retain the schedule set used at generation time.
- A class override must replace, not add to, section days.
- Missing or conflicting schedules must produce a safe, observable failure and must not silently fall back to legacy or guessed weekdays.
- Operations dashboards and analytics must use generated register expectations / the shared resolver rather than independently reconstructing section or class schedules.
- Student portal attendance consistency remains required: the definition of an expected school day must be shared, not reimplemented separately.
- Existing legacy attendance records and existing attendance analytics must remain unchanged by this setup refactor unless a separate approved migration explicitly addresses them.

## 9. Migration and rollout safety

The implementation migration must be additive and explicit/manual.

- Create the new schedule-set and schedule-day tables and indexes.
- Add the new register FK column and compatibility check without deleting legacy schedule rows or register history.
- Preserve existing `class_attendance_schedules` and its FK for historical compatibility.
- Do not insert the confirmed section defaults, class overrides, or academic periods automatically in the migration.
- Do not alter or delete rows in the legacy `attendance` table.
- Do not activate scheduler delivery or change notification flags as part of this work.
- Provide read-only preflight and post-migration verification SQL: table/column/index/constraint checks, row counts, orphan checks, and legacy register reference checks.
- Validate migration and service behavior in CI/test databases before requesting production execution.
- Production migration and setup entry are separate user-approved steps. No production write without explicit approval after a read-only preflight.

## 10. Required tests

1. Section defaults resolve for classes with no override.
2. Class override fully replaces section weekdays.
3. Override applies only within its effective dates; inheritance resumes afterward.
4. A section schedule change affects inheriting classes but not classes with active overrides.
5. Different sections can use different weekdays.
6. Empty weekday lists, duplicate weekdays, invalid weekdays, and overlapping sets are rejected.
7. Same-scope concurrent schedule writes cannot create overlapping effective sets.
8. Readiness accepts inherited schedules and reports their source and weekdays.
9. Readiness rejects missing or conflicting schedules.
10. Register generation creates registers only on resolved opening days and stores schedule_set_id.
11. Generation skips dates outside academic periods and approved closures.
12. Existing legacy registers retain their original schedule_id and remain readable.
13. Operations dashboards, analytics, and student portal use consistent expected-day logic.
14. Admin authorization, audit logging, mobile usability, and offline behavior remain covered.

## 11. Delivery sequence

- **Phase A — schema and shared resolver:** additive migration, validation helpers, schedule resolution service, unit/integration tests.
- **Phase B — setup interface and readiness:** section defaults, complete class overrides, effective-date history, readiness display.
- **Phase C — register generation and consumers:** generation, operations, analytics, portal consistency, regression tests.
- **Phase D — controlled configuration:** read-only production preflight, user-approved migration, verification, then separately approved setup entry.

Each phase should be a reviewable PR. Do not merge a phase with failing CI or unresolved data-safety concerns. Do not create production configuration automatically.
