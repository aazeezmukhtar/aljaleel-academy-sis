# Section-aware attendance foundation

## Scope

This migration adds explicit section ownership to attendance records. A row's
section is derived from its existing class relationship:

`attendance.class_id -> classes.id -> classes.section_id`.

It does not infer section from a student's current enrollment, alter historical
attendance dates/sessions/terms, or change `arm_id`.

## Production evidence already reviewed

The production preflight reported 6,163 attendance rows, with no missing student
or class references, no rows whose class had a missing section, and no
student/class school mismatches. Grouping by student, class-derived section,
date, session, and term returned no duplicates. All 6,163 `arm_id` values are
NULL; arms remain supported and are not changed by this migration.

These checks are historical observations, not a substitute for rerunning the
preflight immediately before applying the migration.

## Required preflight (read-only)

Run against the target database immediately before migration:

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE a.student_id IS NULL) AS missing_student,
  COUNT(*) FILTER (WHERE a.class_id IS NULL) AS missing_class,
  COUNT(*) FILTER (WHERE c.id IS NULL) AS missing_class_reference,
  COUNT(*) FILTER (WHERE c.section_id IS NULL) AS missing_class_section
FROM attendance a
LEFT JOIN classes c ON c.id = a.class_id;

SELECT COUNT(*) AS student_class_school_mismatches
FROM attendance a
JOIN students s ON s.id = a.student_id
JOIN classes c ON c.id = a.class_id
WHERE s.school_id IS DISTINCT FROM c.school_id;

SELECT a.student_id, c.section_id, a.date, a.session, a.term, COUNT(*) AS rows
FROM attendance a
JOIN classes c ON c.id = a.class_id
GROUP BY a.student_id, c.section_id, a.date, a.session, a.term
HAVING COUNT(*) > 1;

SELECT COUNT(*) AS attendance_rows_with_arm_id
FROM attendance
WHERE arm_id IS NOT NULL;
```

Do not proceed if the ownership counts are non-zero, school mismatches exist,
or the duplicate query returns rows. Resolve those records separately with
evidence; do not guess.

## Migration behavior

`20261118_section_aware_attendance.postgres.sql`:

1. Adds nullable `attendance.section_id`.
2. Backfills it from `classes.section_id` using `attendance.class_id`.
3. Stops with an exception if ownership is missing, an existing section value
   conflicts with the class, student/class school ownership differs, or the new
   uniqueness key has duplicates.
4. Enforces NOT NULL and a foreign key to `sections(id)`.
5. Replaces the old global unique constraint
   `(student_id, date, session, term)` with
   `(student_id, section_id, date, session, term)`.

The migration is explicit/manual and is not part of application startup. Test it
against a disposable PostgreSQL database matching the deployed schema, secure a
verified backup, and obtain explicit production approval before execution.

## Operational invariant

New attendance writes must resolve section from the selected class on the
server. Never accept a client-supplied section as authoritative. A class's
section ownership must not be changed casually after attendance has been
recorded; any such operation needs an audited, deliberate data migration.
