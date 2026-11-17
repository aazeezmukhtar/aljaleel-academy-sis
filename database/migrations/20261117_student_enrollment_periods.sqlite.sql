-- AcadMe dated student enrollment periods (SQLite)
-- Additive foundation only. No legacy dates are inferred and no existing rows are changed.
-- Execute explicitly after verifying the target database schema and testing a backup copy.

CREATE TABLE IF NOT EXISTS student_enrollment_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    section_id INTEGER NOT NULL REFERENCES sections(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    session TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    start_event_id INTEGER REFERENCES student_enrollment_history(id),
    end_event_id INTEGER REFERENCES student_enrollment_history(id),
    date_status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (date_status IN ('confirmed', 'review_needed')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_student_enrollment_periods_timeline
    ON student_enrollment_periods (school_id, student_id, section_id, start_date, end_date, id);

CREATE INDEX IF NOT EXISTS idx_student_enrollment_periods_class_session
    ON student_enrollment_periods (school_id, section_id, class_id, session, start_date);

CREATE INDEX IF NOT EXISTS idx_student_enrollment_periods_open
    ON student_enrollment_periods (school_id, student_id, section_id)
    WHERE end_date IS NULL;
