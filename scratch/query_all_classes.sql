-- Query to inspect all classes, their section names, and how they appear
SELECT c.id, c.name, c.section_id, s.name as section_name
FROM classes c
LEFT JOIN sections s ON c.section_id = s.id
ORDER BY s.name, c.name;
