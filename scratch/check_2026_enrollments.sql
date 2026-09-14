-- Check total count and date of 2026/2027 enrollments
SELECT COUNT(*) as total_2026_enrollments, 
       COUNT(DISTINCT student_id) as total_students_enrolled_2026
FROM student_enrollments
WHERE session = '2026/2027';

-- Breakdown by class in 2026/2027
SELECT se.class_id, c.name as class_name, c.section_id, s.name as section_name, COUNT(*) as student_count
FROM student_enrollments se
JOIN classes c ON se.class_id = c.id
JOIN sections s ON c.section_id = s.id
WHERE se.session = '2026/2027'
GROUP BY se.class_id, c.name, c.section_id, s.name
ORDER BY c.section_id, c.name;
