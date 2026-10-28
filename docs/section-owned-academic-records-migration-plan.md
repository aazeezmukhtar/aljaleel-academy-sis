# Section-Owned Academic Records: Safe Migration Plan

## Purpose

Keep one student identity while storing and evaluating Academy and Tahfeez academic records independently. No improvement/decline comparison may combine scores from different sections.

This document is a design and rollout plan only. It does not change the database or production data.

## Confirmed current constraints

- The section-owned academic-record migration adds nullable `class_id` to `results` and `affective_psychomotor`. Existing legacy rows remain unresolved with `class_id = NULL` until a reviewed backfill proves ownership.
- `subject_assignments` connects subject, class, teacher, and session. A subject can potentially be assigned to more than one class.
- Current direct result entry and import code write `class_id` and validate class/session/subject/enrollment context. Keep these checks aligned as the code evolves.
- Result-entry reads and report queries must constrain results to the explicitly selected `class_id`; a legacy row with NULL ownership must not be silently treated as belonging to the currently selected class.
- Some academic overview code already joins results by explicit class ownership; continue auditing each query rather than assuming all reporting paths are consistent.
- `affective_psychomotor` has no class context and is unique by student, trait, term, and session.
- `attendance` stores `class_id`, but its uniqueness constraint is student/date/session/term without class_id. Filtering reports by class does not by itself solve same-day attendance for students in two sections.

## Target data model

### Results

Add nullable `class_id` referencing `classes(id)` as a compatibility step. New writes must require it after the application has been updated.

The long-term identity for a result should be `student_id + class_id + subject_id + term + session`. This permits the same student and subject to be assessed separately in two classes/sections while preventing duplicate marks for the same class and period.

Do not remove the old uniqueness constraint until a reviewed migration has backfilled all unambiguous rows and the application is ready to write class-owned results. SQLite requires a safe table rebuild to replace a table-level UNIQUE constraint; PostgreSQL requires an explicit constraint/index migration. Preserve result IDs, scores, grades, remarks, approval/publication statuses, and approver references.

### Affective and psychomotor traits

If these traits are intended to appear independently on Academy and Tahfeez reports, add class ownership and make uniqueness class-aware. If the school intends traits to be student-wide, label them as student-wide and do not imply they measure a specific section. Confirm this policy before migration.

### Attendance

Review whether students should have separate attendance records for Academy and Tahfeez on the same date. If yes, change uniqueness to include class_id using an engine-specific migration. Preserve current rows and report any historical rows whose class cannot be established.

## Historical backfill policy — never guess

Run a read-only classification first. For each legacy result, find classes where:
1. the student is enrolled in that class for the result session; and
2. the subject is assigned to that class for the result session.

Classify each row as:
- **Unambiguous:** exactly one matching class; eligible for automatic backfill after preview and backup.
- **Ambiguous:** multiple matching classes; leave unresolved for manual review.
- **Unmatched:** no matching class; leave unresolved and investigate.
- **Conflicting:** a class-specific row would collide with another existing result; stop and review.

Generate counts and a reviewable CSV/report of ambiguous, unmatched, and conflicting records before any write. Never delete or overwrite a mark to force a backfill.

## Required application changes

1. Result entry: validate class, student enrollment, subject assignment, and assignment session; save `class_id`; use class-aware upsert and lock/status checks.
2. Bulk import: require/validate class context, verify every student is enrolled in that class/session, verify every subject is assigned in that class/session, and import with `class_id`. Reject the whole file before writes if any row is invalid.
3. Individual and bulk term/cumulative reports: query results by explicit `class_id`; do not infer result ownership from subject assignments when a class-owned row exists.
4. Ranking and analytics: aggregate only results for the selected class. Compare improvement only within the same section and comparable subjects/periods.
5. Academic overview and exports: audit all queries joining results to enrollments; avoid counting one mark in multiple classes.
6. Result approval, locking, publishing, and audit trails: ensure operations target the intended class-owned rows and do not cross section boundaries.
7. Student traits and attendance: apply the separately agreed ownership policies above.

## Safe rollout sequence

1. Add tests using disposable SQLite data for dual-enrolled students, shared subjects, distinct marks by section, import validation, ranking, cumulative reports, lock/publish behavior, and transaction rollback.
2. Implement engine-specific schema migrations in a separate branch. Do not run migrations against production while developing.
3. Add a read-only production audit query/report that classifies legacy rows. Do not expose student-identifying details in logs.
4. Back up production data and rehearse migration/rollback on a recent isolated copy.
5. Backfill only unambiguous rows in a transaction with before/after counts and verification queries.
6. Manually reconcile ambiguous rows with school-approved source records; if ownership cannot be proven, preserve the legacy row as unresolved rather than assigning it arbitrarily.
7. Deploy compatible application code, verify reports for Academy-only, Tahfeez-only, and dual-enrolled students, then consider enforcing non-null class ownership for new results.
8. Keep the migration reversible until verification is signed off. Never run a destructive migration or rewrite historical results without explicit approval.

## Acceptance criteria

- Same student can have different marks for the same subject, term, and session in different classes when intended.
- Academy report cards, cumulative reports, ranks, and analytics never include Tahfeez-owned marks, and vice versa.
- Import and direct entry both enforce the same class/session/subject/enrollment rules.
- A dual-enrolled student's class position is calculated only from the selected class's results.
- Ambiguous historical records are reported, not guessed, dropped, or silently overwritten.
- All migration tests run against disposable databases; production data remains unchanged until explicit authorization.
