-- Query to see all students currently assigned to Primary 2 (class_id = 28)
-- and check whether they have an R 2 (class_id = 12) enrollment in student_enrollments
SELECT 
    s.id AS student_id,
    s.first_name || ' ' || s.last_name AS student_name,
    s.admission_number,
    s.current_class_id,
    -- Check if they are enrolled in R 2 in 2026/2027:
    se_r2.class_id AS r2_class_id,
    -- Check if they are enrolled in Primary 2 in student_enrollments:
    se_p2.class_id AS p2_enrollment_class_id,
    -- Check their 2025/2026 enrollment:
    se_2025.class_id AS class_2025_id,
    c_2025.name AS class_2025_name
FROM students s
LEFT JOIN student_enrollments se_r2 
    ON s.id = se_r2.student_id AND se_r2.class_id = 12 -- R 2
LEFT JOIN student_enrollments se_p2 
    ON s.id = se_p2.student_id AND se_p2.class_id = 28 -- Primary 2
LEFT JOIN student_enrollments se_2025 
    ON s.id = se_2025.student_id AND se_2025.session = '2025/2026'
LEFT JOIN classes c_2025 
    ON se_2025.class_id = c_2025.id
WHERE s.current_class_id = 28 OR se_p2.id IS NOT NULL
ORDER BY se_2025.class_id NULLS LAST, s.last_name;
