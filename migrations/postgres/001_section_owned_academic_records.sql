-- Explicit, reviewed PostgreSQL migration; do not run automatically on deploy.
-- Legacy records stay NULL until a read-only audit proves their class ownership.
BEGIN;

ALTER TABLE results ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id);
ALTER TABLE affective_psychomotor ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id);

-- Drop all legacy uniqueness rules, which prevent the same subject/trait being
-- recorded independently for two sections. Production inspection found two
-- equivalent UNIQUE constraints on results, so both names must be removed.
ALTER TABLE results
  DROP CONSTRAINT IF EXISTS results_student_id_subject_id_term_session_key;
ALTER TABLE results
  DROP CONSTRAINT IF EXISTS results_student_subject_term_session_key;
ALTER TABLE affective_psychomotor
  DROP CONSTRAINT IF EXISTS affective_psychomotor_student_id_trait_name_term_session_key;

ALTER TABLE results
  ADD CONSTRAINT results_student_class_subject_term_session_key
  UNIQUE (student_id, class_id, subject_id, term, session);
ALTER TABLE affective_psychomotor
  ADD CONSTRAINT affective_student_class_trait_term_session_key
  UNIQUE (student_id, class_id, trait_name, term, session);

CREATE INDEX IF NOT EXISTS idx_results_class_session_term
  ON results(class_id, session, term);
CREATE INDEX IF NOT EXISTS idx_traits_class_session_term
  ON affective_psychomotor(class_id, session, term);

COMMIT;
