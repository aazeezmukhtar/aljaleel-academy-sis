-- READ-ONLY legacy ownership audit. SELECT statements only; safe to run BEFORE migration 001.
-- This audit intentionally does not reference class_id because that column is
-- absent from the current production schema. It identifies candidates only;
-- a candidate is NOT proof of ownership and must be checked against source records.
--
-- Results: candidate class requires a same-session enrollment (matching the
-- result term, or a session-level enrollment with NULL term) and a subject
-- assignment to that same class and session. Missing assignment history is
-- reported as unmatched, never inferred from subject name alone.

WITH result_candidates AS (
  SELECT r.id AS result_id, se.class_id
  FROM results r
  JOIN student_enrollments se
    ON se.student_id = r.student_id
   AND se.session = r.session
   AND (se.term = r.term OR se.term IS NULL)
  JOIN subject_assignments sa
    ON sa.class_id = se.class_id
   AND sa.subject_id = r.subject_id
   AND sa.session = r.session
),
result_audit AS (
  SELECT r.id, r.student_id, r.subject_id, r.term, r.session,
         COUNT(DISTINCT rc.class_id) AS candidate_count,
         ARRAY_AGG(DISTINCT rc.class_id ORDER BY rc.class_id)
           FILTER (WHERE rc.class_id IS NOT NULL) AS candidate_class_ids
  FROM results r
  LEFT JOIN result_candidates rc ON rc.result_id = r.id
  GROUP BY r.id, r.student_id, r.subject_id, r.term, r.session
)
SELECT id AS result_id, student_id, subject_id, term, session,
       candidate_count, candidate_class_ids,
       CASE WHEN candidate_count = 1 THEN 'ONE CANDIDATE - verify before backfill'
            WHEN candidate_count = 0 THEN 'UNMATCHED - leave unresolved'
            ELSE 'AMBIGUOUS - leave unresolved' END AS ownership_status
FROM result_audit
ORDER BY session, term, id;

-- Traits: candidates are all same-session enrollments for the student,
-- term-aware. Even one candidate must be checked against original assessment
-- records and section context before any backfill.
WITH trait_candidates AS (
  SELECT ap.id AS trait_id, se.class_id
  FROM affective_psychomotor ap
  JOIN student_enrollments se
    ON se.student_id = ap.student_id
   AND se.session = ap.session
   AND (se.term = ap.term OR se.term IS NULL)
),
trait_audit AS (
  SELECT ap.id, ap.student_id, ap.trait_name, ap.term, ap.session,
         COUNT(DISTINCT tc.class_id) AS candidate_count,
         ARRAY_AGG(DISTINCT tc.class_id ORDER BY tc.class_id)
           FILTER (WHERE tc.class_id IS NOT NULL) AS candidate_class_ids
  FROM affective_psychomotor ap
  LEFT JOIN trait_candidates tc ON tc.trait_id = ap.id
  GROUP BY ap.id, ap.student_id, ap.trait_name, ap.term, ap.session
)
SELECT id AS trait_id, student_id, trait_name, term, session,
       candidate_count, candidate_class_ids,
       CASE WHEN candidate_count = 1 THEN 'ONE ENROLLMENT - verify section from source records'
            WHEN candidate_count = 0 THEN 'UNMATCHED - leave unresolved'
            ELSE 'AMBIGUOUS - leave unresolved' END AS ownership_status
FROM trait_audit
ORDER BY session, term, id;

-- Summary counts only; no identifying details.
SELECT 'results' AS record_type, COUNT(*) AS unresolved_rows
FROM results
UNION ALL
SELECT 'affective_psychomotor', COUNT(*)
FROM affective_psychomotor;
