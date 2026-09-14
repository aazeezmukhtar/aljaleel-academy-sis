-- Find the exact students enrolled in 2025/2026 whose current_class_id does NOT match their 2025/2026 class_id
SELECT 
    s.id AS student_id,
    s.first_name || ' ' || s.last_name AS student_name,
    s.admission_number,
    se.class_id AS pre_promotion_class_id,
    c_prev.name AS pre_promotion_class_name,
    s.current_class_id AS current_db_class_id,
    c_curr.name AS current_db_class_name
FROM students s
JOIN student_enrollments se ON s.id = se.student_id AND se.session = '2025/2026'
JOIN classes c_prev ON se.class_id = c_prev.id
LEFT JOIN classes c_curr ON s.current_class_id = c_curr.id
WHERE s.current_class_id <> se.class_id
ORDER BY se.class_id, s.last_name, s.first_name;
