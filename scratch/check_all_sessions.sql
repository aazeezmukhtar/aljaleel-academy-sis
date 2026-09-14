-- Check all sessions in student_enrollments
SELECT session, COUNT(*) as count, COUNT(DISTINCT student_id) as students
FROM student_enrollments
GROUP BY session
ORDER BY session;
