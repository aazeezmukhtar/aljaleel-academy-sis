-- Forensic inspection: Who are the 56 students currently in Primary 2 (class_id = 28)?
SELECT 
    s.id AS student_id,
    s.first_name || ' ' || s.last_name AS student_name,
    s.admission_number,
    s.current_class_id,
    se_2025.class_id AS class_2025_id,
    c_2025.name AS class_2025_name,
    c_2025.section_id AS section_2025_id,
    sec_2025.name AS section_2025_name,
    se_2026.class_id AS class_2026_id,
    c_2026.name AS class_2026_name
FROM students s
LEFT JOIN student_enrollments se_2025 ON s.id = se_2025.student_id AND se_2025.session = '2025/2026'
LEFT JOIN classes c_2025 ON se_2025.class_id = c_2025.id
LEFT JOIN sections sec_2025 ON c_2025.section_id = sec_2025.id
LEFT JOIN student_enrollments se_2026 ON s.id = se_2026.student_id AND se_2026.session = '2026/2027'
LEFT JOIN classes c_2026 ON se_2026.class_id = c_2026.id
WHERE s.current_class_id = 28 -- Primary 2
ORDER BY c_2025.name NULLS LAST, c_2026.name NULLS LAST, s.last_name, s.first_name;
