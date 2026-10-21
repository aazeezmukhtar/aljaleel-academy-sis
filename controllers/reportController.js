const db = require('../utils/db');

const getAuditLogs = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    if (user.role !== 'Admin') {
        return res.status(403).send('Access Denied');
    }
    try {
        const logs = await db.all('SELECT * FROM audit_logs WHERE school_id = ? ORDER BY created_at DESC LIMIT 100', [schoolId]);
        res.render('settings/audit', { title: 'Audit Logs', logs });
    } catch (err) {
        console.error('Audit Log Error:', err);
        res.status(500).send('Database Error');
    }
};

const getAcademicReports = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    try {
        let classPerf;
        if (user.role === 'Admin') {
            classPerf = await db.all(`
                SELECT c.name as class_name, AVG(r.total) as avg_score, COUNT(r.id) as result_count
                FROM classes c
                JOIN sections sec ON c.section_id = sec.id
                JOIN student_enrollments se ON c.id = se.class_id AND se.session = sec.current_session
                JOIN results r ON se.student_id = r.student_id AND se.session = r.session
                WHERE c.school_id = ?
                GROUP BY c.id, c.name
            `, [schoolId]);
        } else {
            classPerf = await db.all(`
                SELECT c.name as class_name, AVG(r.total) as avg_score, COUNT(r.id) as result_count
                FROM classes c
                JOIN sections sec ON c.section_id = sec.id
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                JOIN student_enrollments se ON c.id = se.class_id AND se.session = sec.current_session
                JOIN results r ON se.student_id = r.student_id AND se.session = r.session
                WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
                  AND c.school_id = ?
                GROUP BY c.id, c.name
            `, [user.id, user.id, user.id, schoolId]);
        }
        res.render('reports/academic', { title: 'Academic Reports', classPerf });
    } catch (err) {
        console.error('Academic Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStudentReports = async (req, res) => {
    const schoolId = req.schoolId || (req.session.staff ? req.session.staff.school_id : 1);
    try {
        const totalStudents = await db.get("SELECT count(*) as count FROM students WHERE status='active' AND school_id = ?", [schoolId]);
        const genderDist = await db.all("SELECT gender, count(*) as count FROM students WHERE status='active' AND school_id = ? GROUP BY gender", [schoolId]);
        const classDist = await db.all(`
            SELECT c.name, count(se.student_id) as count
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN sections sec ON c.section_id = sec.id
            JOIN students s ON se.student_id = s.id
            WHERE s.status='active' AND se.session = sec.current_session
              AND s.school_id = ?
            GROUP BY c.id, c.name
        `, [schoolId]);
        const recentAdmissions = await db.all(`
            SELECT first_name, last_name, admission_number, admission_date 
            FROM students 
            WHERE status='active' AND school_id = ?
            ORDER BY admission_date DESC 
            LIMIT 5
        `, [schoolId]);
        res.render('reports/students', {
            title: 'Student Demographics',
            stats: { total: totalStudents ? totalStudents.count : 0, gender: genderDist, classes: classDist, recent: recentAdmissions }
        });
    } catch (err) {
        console.error('Student Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getAttendanceReports = async (req, res) => {
    const schoolId = req.schoolId || (req.session.staff ? req.session.staff.school_id : 1);
    try {
        const attendanceStats = await db.all(`
            SELECT c.name as class_name, 
                   count(CASE WHEN a.status='Present' THEN 1 END) as present_count,
                   count(a.id) as total_records
            FROM attendance a
            JOIN classes c ON a.class_id = c.id
            WHERE c.school_id = ?
            GROUP BY c.id
        `, [schoolId]);
        res.render('reports/attendance', { title: 'Attendance Reports', stats: attendanceStats });
    } catch (err) {
        console.error('Attendance Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getFeeReports = async (req, res) => {
    const schoolId = req.schoolId || (req.session.staff ? req.session.staff.school_id : 1);
    try {
        const feeStats = await db.get(`
            SELECT 
                SUM(sf.total_amount) as expected, 
                SUM(sf.paid_amount) as collected, 
                SUM(sf.total_amount - sf.paid_amount) as outstanding 
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            WHERE s.school_id = ?
        `, [schoolId]);
        const categoryStats = await db.all(`
             SELECT fc.name, SUM(sf.total_amount) as expected, SUM(sf.paid_amount) as collected
             FROM student_fees sf
             JOIN fee_categories fc ON sf.fee_category_id = fc.id
             JOIN students s ON sf.student_id = s.id
             WHERE s.school_id = ?
             GROUP BY fc.id
        `, [schoolId]);
        const debtors = await db.all(`
            SELECT s.id, s.first_name, s.last_name, s.admission_number,
                   SUM(sf.total_amount) as total_owed,
                   SUM(sf.paid_amount) as total_paid,
                   SUM(sf.total_amount - sf.paid_amount) as outstanding
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            WHERE s.school_id = ?
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number
            HAVING SUM(sf.total_amount - sf.paid_amount) > 0
            ORDER BY outstanding DESC
        `, [schoolId]);
        res.render('reports/fees', { title: 'Fee Reports', feeStats: feeStats || { expected: 0, collected: 0, outstanding: 0 }, categoryStats, debtors });
    } catch (err) {
        console.error('Fee Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStaffReports = async (req, res) => {
    const schoolId = req.schoolId || (req.session.staff ? req.session.staff.school_id : 1);
    try {
        const staff = await db.all(`
            SELECT s.*, 
                   COUNT(DISTINCT ca.class_id) as class_count,
                   COUNT(DISTINCT sa.subject_id) as subject_count
            FROM staff s
            LEFT JOIN class_assignments ca ON s.id = ca.staff_id
            LEFT JOIN subject_assignments sa ON s.id = sa.teacher_id
            WHERE s.school_id = ?
            GROUP BY s.id
            ORDER BY s.last_name, s.first_name
        `, [schoolId]);
        res.render('reports/staff', { title: 'Staff Reports', staff });
    } catch (err) {
        console.error('Staff Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getHealthReports = async (req, res) => {
    const schoolId = req.schoolId || (req.session.staff ? req.session.staff.school_id : 1);
    try {
        const students = await db.all(`
            SELECT s.id, s.first_name, s.last_name, s.admission_number, s.parent_phone, s.parent_address
            FROM students s
            WHERE s.status='active' AND s.school_id = ?
            ORDER BY s.last_name, s.first_name
        `, [schoolId]);

        if (students.length > 0) {
            const enrollments = await db.all(`
                SELECT se.student_id, c.name as class_name
                FROM student_enrollments se
                JOIN classes c ON se.class_id = c.id
                JOIN sections sec ON c.section_id = sec.id
                WHERE se.session = sec.current_session AND c.school_id = ?
            `, [schoolId]);

            const classMap = new Map();
            enrollments.forEach(e => {
                if (!classMap.has(e.student_id)) {
                    classMap.set(e.student_id, []);
                }
                classMap.get(e.student_id).push(e.class_name);
            });

            students.forEach(s => {
                const classes = classMap.get(s.id) || [];
                s.class_name = classes.length > 0 ? classes.join(', ') : 'Not Enrolled';
            });
        }

        res.render('reports/health', { title: 'Health & Emergency Contacts', students });
    } catch (err) {
        console.error('Health Report Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getAuditLogs,
    getAcademicReports,
    getStudentReports,
    getAttendanceReports,
    getFeeReports,
    getStaffReports,
    getHealthReports
};

