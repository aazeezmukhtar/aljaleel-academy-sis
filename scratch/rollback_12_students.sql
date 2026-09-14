-- Rollback transaction for the 12 affected students
-- Safe, atomic, explicit student IDs only
BEGIN;

-- Restore students.current_class_id to their verified 2025/2026 class
UPDATE students SET current_class_id = 11 WHERE id = 342; -- FATIMA IBRAHIM back to Nursery 1
UPDATE students SET current_class_id = 18 WHERE id IN (124, 134, 135, 149, 153, 1, 155, 152); -- Back to Nursery 2
UPDATE students SET current_class_id = 25 WHERE id IN (156, 122, 142); -- Back to Primary 1

-- Verification inside transaction
SELECT 
    s.id AS student_id,
    s.first_name || ' ' || s.last_name AS student_name,
    s.admission_number,
    s.current_class_id,
    c.name AS restored_class_name
FROM students s
JOIN classes c ON s.current_class_id = c.id
WHERE s.id IN (342, 124, 134, 135, 149, 153, 1, 155, 152, 156, 122, 142)
ORDER BY s.current_class_id, s.last_name, s.first_name;

-- Check remaining diverged records for 2025/2026:
SELECT COUNT(*) AS remaining_diverged_count
FROM students s
JOIN student_enrollments se ON s.id = se.student_id AND se.session = '2025/2026'
WHERE s.current_class_id <> se.class_id;

COMMIT;
