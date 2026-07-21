const db = require('../utils/db');

const getDashboard = async (req, res) => {
    try {
        const user = req.session.staff;
        const today = new Date().toISOString().split('T')[0];

        if (user.role === 'Admin') {
            const totalStudents = (await db.get("SELECT COUNT(*) as count FROM students WHERE status = 'active'")).count;
            const activeStaffCount = (await db.get("SELECT COUNT(*) as count FROM staff")).count;

            const attendanceData = await db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present
                FROM attendance 
                WHERE date = ?
            `, [today]);

            const attendance = attendanceData.total > 0
                ? ((attendanceData.present / attendanceData.total) * 100).toFixed(1) + '%'
                : 'N/A';

            const feeStats = await db.get(`
                SELECT 
                    SUM(total_amount) as expected,
                    SUM(paid_amount) as collected
                FROM student_fees
            `);
            const revenuePercentage = feeStats.expected > 0 
                ? Math.round((feeStats.collected / feeStats.expected) * 100) 
                : 0;

            const totalSubjects = (await db.get("SELECT COUNT(*) as count FROM subjects")).count;

            const genderStats = await db.all(`
                SELECT gender, COUNT(*) as count 
                FROM students 
                WHERE status = 'active' 
                GROUP BY gender
            `);
            const genderSummary = { Male: 0, Female: 0 };
            genderStats.forEach(g => {
                if (g.gender === 'Male' || g.gender === 'Female') {
                    genderSummary[g.gender] = g.count;
                }
            });

            const recentEnrollments = await db.all(`
<<<<<<< HEAD
                SELECT s.first_name, s.last_name, c.name as class_name, s.admission_date
                FROM students s
                LEFT JOIN classes c ON s.current_class_id = c.id
=======
                SELECT s.first_name, s.last_name, s.admission_date,
                       (
                           SELECT c.name 
                           FROM student_enrollments se 
                           JOIN classes c ON se.class_id = c.id 
                           JOIN sections sec ON c.section_id = sec.id
                           WHERE se.student_id = s.id AND se.session = sec.current_session 
                           LIMIT 1
                       ) as class_name
                FROM students s
>>>>>>> local-master
                ORDER BY s.admission_date DESC
                LIMIT 5
            `);

            const announcements = await db.all(`
                SELECT * FROM announcements 
                ORDER BY created_at DESC LIMIT 10
            `);

            const upcomingEvents = await db.all(`
                SELECT * FROM term_events 
                WHERE event_date >= ? 
                ORDER BY event_date ASC LIMIT 3
            `, [today]);

            return res.render('dashboard', {
                title: 'Nexus SIS - Admin Dashboard',
                role: 'Admin',
                stats: {
                    totalStudents,
                    activeStaff: activeStaffCount,
                    attendance,
                    revenuePercentage,
                    totalSubjects,
                    genderSummary
                },
                recentEnrollments,
                announcements,
                upcomingEvents
            });
        } else {
            const assignedClasses = await db.all(`
                SELECT DISTINCT c.id, c.name 
                FROM class_assignments ca
                JOIN classes c ON ca.class_id = c.id
                WHERE ca.staff_id = ?
            `, [user.id]);

            const assignedSubjects = await db.all(`
                SELECT DISTINCT s.id, s.name, c.name as class_name
                FROM subject_assignments sa
                JOIN subjects s ON sa.subject_id = s.id
                JOIN classes c ON sa.class_id = c.id
                WHERE sa.teacher_id = ?
            `, [user.id]);

            const myStudentsCount = (await db.get(`
<<<<<<< HEAD
                SELECT COUNT(*) as count 
                FROM students 
                WHERE current_class_id IN (
                    SELECT class_id FROM class_assignments WHERE staff_id = ?
                ) AND status = 'active'
=======
                SELECT COUNT(DISTINCT se.student_id) as count 
                FROM student_enrollments se
                JOIN students s ON se.student_id = s.id
                JOIN classes c ON se.class_id = c.id
                JOIN sections sec ON c.section_id = sec.id
                WHERE se.session = sec.current_session AND se.class_id IN (
                    SELECT class_id FROM class_assignments WHERE staff_id = ?
                ) AND s.status = 'active'
>>>>>>> local-master
            `, [user.id])).count;

            const myAttendanceData = await db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present
                FROM attendance 
                WHERE date = ? AND class_id IN (
                    SELECT class_id FROM class_assignments WHERE staff_id = ?
                )
            `, [today, user.id]);

            const myAttendance = myAttendanceData.total > 0
                ? ((myAttendanceData.present / myAttendanceData.total) * 100).toFixed(1) + '%'
                : 'Pending';

            const announcements = await db.all(`
                SELECT * FROM announcements 
                WHERE is_published = 1 AND (target_role = ? OR target_role = 'All')
                ORDER BY created_at DESC LIMIT 5
            `, [user.role]);

            const upcomingEvents = await db.all(`
                SELECT * FROM term_events 
                WHERE event_date >= ? 
                ORDER BY event_date ASC LIMIT 3
            `, [today]);

            return res.render('dashboard_staff', {
                title: 'Nexus SIS - Staff Dashboard',
                role: user.role,
                stats: {
                    assignedClasses: assignedClasses.length,
                    assignedSubjects: assignedSubjects.length,
                    myStudents: myStudentsCount,
                    attendanceToday: myAttendance
                },
                assignedClasses,
                assignedSubjects,
                announcements,
                upcomingEvents
            });
        }
    } catch (err) {
        console.error('Dashboard Data Error:', err);
        res.status(500).send('Internal Server Error');
    }
};


module.exports = { getDashboard };
