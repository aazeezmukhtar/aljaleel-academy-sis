-- Explicit, reviewed PostgreSQL migration; do not run automatically on deploy.
-- Adds class ownership while preserving every legacy row as unresolved (class_id NULL).
-- Run only after reviewing the production audit and securing a recoverable backup.
BEGIN;

ALTER TABLE results
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id);
ALTER TABLE affective_psychomotor
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id);

-- Remove legacy uniqueness rules that prevent the same student/subject or
-- student/trait from being recorded independently in Academy and Tahfeez.
-- The old rules are replaced by class-aware uniqueness for owned records and
-- partial uniqueness for unresolved legacy records.
ALTER TABLE results
  DROP CONSTRAINT IF EXISTS results_student_id_subject_id_term_session_key;
ALTER TABLE results
  DROP CONSTRAINT IF EXISTS results_student_subject_term_session_key;
ALTER TABLE affective_psychomotor
  DROP CONSTRAINT IF EXISTS affective_psychomotor_student_id_trait_name_term_session_key;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'results_student_class_subject_term_session_key'
      AND conrelid = 'public.results'::regclass
  ) THEN
    ALTER TABLE results
      ADD CONSTRAINT results_student_class_subject_term_session_key
      UNIQUE (student_id, class_id, subject_id, term, session);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'affective_student_class_trait_term_session_key'
      AND conrelid = 'public.affective_psychomotor'::regclass
  ) THEN
    ALTER TABLE affective_psychomotor
      ADD CONSTRAINT affective_student_class_trait_term_session_key
      UNIQUE (student_id, class_id, trait_name, term, session);
  END IF;
END
$migration$;

-- PostgreSQL UNIQUE constraints allow multiple NULL class_id values. These
-- partial indexes preserve the old one-row-per-student/subject/period rule
-- for unresolved legacy rows without blocking class-owned rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_unassigned_legacy_unique
  ON results(student_id, subject_id, term, session)
  WHERE class_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_traits_unassigned_legacy_unique
  ON affective_psychomotor(student_id, trait_name, term, session)
  WHERE class_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_results_class_session_term
  ON results(class_id, session, term);
CREATE INDEX IF NOT EXISTS idx_traits_class_session_term
  ON affective_psychomotor(class_id, session, term);

COMMIT;
