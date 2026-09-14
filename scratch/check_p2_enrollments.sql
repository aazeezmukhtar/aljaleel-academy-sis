-- Check if student_enrollments has any rows for Primary 2 (class_id = 28) in any session
SELECT COUNT(*) as primary_2_enrollments_count
FROM student_enrollments
WHERE class_id = 28;
