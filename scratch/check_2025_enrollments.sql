-- Pre-promotion distribution in 2025/2026
SELECT se.class_id, c.name as class_name, c.section_id, s.name as section_name, COUNT(*) as student_count
FROM student_enrollments se
JOIN classes c ON se.class_id = c.id
JOIN sections s ON c.section_id = s.id
WHERE se.session = '2025/2026'
GROUP BY se.class_id, c.name, c.section_id, s.name
ORDER BY c.section_id, c.name;
