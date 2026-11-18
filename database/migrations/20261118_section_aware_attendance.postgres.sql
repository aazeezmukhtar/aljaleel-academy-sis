-- AcadMe section-aware attendance foundation (PostgreSQL)
-- Explicit/manual migration. Do not wire into startup or execute against production
-- until the documented preflight, backup, and approval steps are complete.

BEGIN;

ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS section_id INTEGER;

-- Section ownership is derived only from the class attached to each attendance row.
-- Existing non-null values are checked below rather than silently overwritten.
UPDATE attendance a
SET section_id = c.section_id
FROM classes c
WHERE a.class_id = c.id
  AND a.section_id IS NULL;

DO $$
DECLARE
    missing_ownership BIGINT;
    conflicting_ownership BIGINT;
    cross_school_rows BIGINT;
    duplicate_rows BIGINT;
BEGIN
    SELECT COUNT(*) INTO missing_ownership
    FROM attendance a
    LEFT JOIN classes c ON c.id = a.class_id
    WHERE a.student_id IS NULL
       OR a.class_id IS NULL
       OR c.id IS NULL
       OR c.section_id IS NULL
       OR a.section_id IS NULL;

    IF missing_ownership > 0 THEN
        RAISE EXCEPTION
            'Attendance migration stopped: % rows lack student/class/section ownership',
            missing_ownership;
    END IF;

    SELECT COUNT(*) INTO conflicting_ownership
    FROM attendance a
    JOIN classes c ON c.id = a.class_id
    WHERE a.section_id IS DISTINCT FROM c.section_id;

    IF conflicting_ownership > 0 THEN
        RAISE EXCEPTION
            'Attendance migration stopped: % rows have section_id inconsistent with their class',
            conflicting_ownership;
    END IF;

    SELECT COUNT(*) INTO cross_school_rows
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.school_id IS DISTINCT FROM c.school_id;

    IF cross_school_rows > 0 THEN
        RAISE EXCEPTION
            'Attendance migration stopped: % rows link a student and class from different schools',
            cross_school_rows;
    END IF;

    SELECT COUNT(*) INTO duplicate_rows
    FROM (
        SELECT student_id, section_id, date, session, term
        FROM attendance
        GROUP BY student_id, section_id, date, session, term
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_rows > 0 THEN
        RAISE EXCEPTION
            'Attendance migration stopped: % duplicate student/section/date/session/term groups exist',
            duplicate_rows;
    END IF;
END $$;

ALTER TABLE attendance
    ALTER COLUMN section_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_section_id_fkey'
          AND conrelid = 'attendance'::regclass
    ) THEN
        ALTER TABLE attendance
            ADD CONSTRAINT attendance_section_id_fkey
            FOREIGN KEY (section_id) REFERENCES sections(id);
    END IF;
END $$;

-- Replace the legacy global uniqueness rule. It prevented one student from
-- having separate Academy and Tahfeez attendance on the same date.
ALTER TABLE attendance
    DROP CONSTRAINT IF EXISTS attendance_student_id_date_session_term_key;

DROP INDEX IF EXISTS attendance_student_id_date_session_term_key;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_student_section_date_session_term_key
    ON attendance (student_id, section_id, date, session, term);

CREATE INDEX IF NOT EXISTS idx_attendance_section_date
    ON attendance (section_id, date);

COMMIT;
