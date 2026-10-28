-- READ-ONLY AUDIT ONLY. Do not wrap these SELECTs in a migration or add UPDATEs.
-- Run against a reviewed backup/copy first. Output may contain student identifiers;
-- keep it access-controlled and do not put rows into application logs.

-- Result ownership candidates:
-- A candidate class must contain the student in the result session and have the
-- result subject assigned to that class in the same session.
WITH result_candidates AS (
  SELECT r.id AS result_id, r.student_id, r.subject_id, r.term, r.session,
         se.class_id
  FROM results r
  JOIN student_enrollments se
    ON se.student_id = r.student_id AND se.session = r.session
  JOIN subject_assignments sa
    ON sa.class_id = se.class_id
   AND sa.subject_id = r.subject_id
   AND sa.session = r.session
  WHERE r.class_id IS NULL
  GROUP BY r.id, r.student_id, r.subject_id, r.term, r.session, se.class_id
),
result_counts AS (
  SELECT result_id, COUNT(*) AS candidate_count
  FROM result_candidates
  GROUP BY result_id
)
SELECT r.id AS result_id,
       r.student_id,
       r.subject_id,
       r.term,
       r.session,
       COALESCE(rc.candidate_count, 0) AS candidate_count,
       CASE
         WHEN COALESCE(rc.candidate_count, 0) = 1 THEN 'unambiguous'
         WHEN COALESCE(rc.candidate_count, 0) > 1 THEN 'ambiguous'
         ELSE 'unmatched'
       END AS ownership_status,
       COALESCE(
         (SELECT STRING_AGG(rct.class_id::text, ',' ORDER BY rct.class_id)
          FROM result_candidates rct WHERE rct.result_id = r.id),
         ''
       ) AS candidate_class_ids
FROM results r
LEFT JOIN result_counts rc ON rc.result_id = r.id
WHERE r.class_id IS NULL
ORDER BY ownership_status, r.session, r.term, r.id;

-- Affective/psychomotor ownership candidates:
-- A candidate class must be an enrollment of the student in that session.
-- Multiple candidate classes are ambiguous; do not copy one trait score into
-- both sections. The original row remains untouched until ownership is proven.
WITH trait_candidates AS (
  SELECT ap.id AS trait_id, ap.student_id, ap.trait_name, ap.term, ap.session,
         se.class_id
  FROM affective_psychomotor ap
  JOIN student_enrollments se
    ON se.student_id = ap.student_id AND se.session = ap.session
  WHERE ap.class_id IS NULL
  GROUP BY ap.id, ap.student_id, ap.trait_name, ap.term, ap.session, se.class_id
),
trait_counts AS (
  SELECT trait_id, COUNT(*) AS candidate_count
  FROM trait_candidates
  GROUP BY trait_id
)
SELECT ap.id AS trait_id,
       ap.student_id,
       ap.trait_name,
       ap.term,
       ap.session,
       COALESCE(tc.candidate_count, 0) AS candidate_count,
       CASE
         WHEN COALESCE(tc.candidate_count, 0) = 1 THEN 'unambiguous'
         WHEN COALESCE(tc.candidate_count, 0) > 1 THEN 'ambiguous'
         ELSE 'unmatched'
       END AS ownership_status,
       COALESCE(
         (SELECT STRING_AGG(tct.class_id::text, ',' ORDER BY tct.class_id)
          FROM trait_candidates tct WHERE tct.trait_id = ap.id),
         ''
       ) AS candidate_class_ids
FROM affective_psychomotor ap
LEFT JOIN trait_counts tc ON tc.trait_id = ap.id
WHERE ap.class_id IS NULL
ORDER BY ownership_status, ap.session, ap.term, ap.id;

-- Summary counts only; use after validating the detailed output above.
WITH candidates AS (
  SELECT r.id AS row_id, COUNT(DISTINCT se.class_id) AS n
  FROM results r
  JOIN student_enrollments se
    ON se.student_id = r.student_id AND se.session = r.session
  JOIN subject_assignments sa
    ON sa.class_id = se.class_id
   AND sa.subject_id = r.subject_id
   AND sa.session = r.session
  WHERE r.class_id IS NULL
  GROUP BY r.id
),
classified AS (
  SELECT r.id AS row_id, COALESCE(c.n, 0) AS n
  FROM results r
  LEFT JOIN candidates c ON c.row_id = r.id
  WHERE r.class_id IS NULL
)
SELECT CASE WHEN n = 1 THEN 'unambiguous'
            WHEN n > 1 THEN 'ambiguous'
            ELSE 'unmatched' END AS ownership_status,
       COUNT(*) AS row_count
FROM classified
GROUP BY ownership_status
ORDER BY ownership_status;
