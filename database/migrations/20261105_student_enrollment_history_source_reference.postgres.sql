-- Upgrade PostgreSQL databases where the original history migration was applied.
-- source_enrollment_id remains a unique historical identifier, not a restrictive FK.
ALTER TABLE student_enrollment_history
    DROP CONSTRAINT IF EXISTS student_enrollment_history_source_enrollment_id_fkey;
