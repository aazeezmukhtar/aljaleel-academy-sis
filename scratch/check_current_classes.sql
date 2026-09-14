-- Check students.current_class_id distribution
SELECT s.current_class_id, c.name as class_name, c.section_id, sec.name as section_name, COUNT(*) as count
FROM students s
LEFT JOIN classes c ON s.current_class_id = c.id
LEFT JOIN sections sec ON c.section_id = sec.id
GROUP BY s.current_class_id, c.name, c.section_id, sec.name
ORDER BY sec.name NULLS LAST, c.name;
