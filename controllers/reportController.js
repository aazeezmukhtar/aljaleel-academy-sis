const db = require('../utils/db');

const getAuditLogs = async (req, res) => {
    const user = req.session.staff;
    if (user.role !== 'Admin') {
        return res.status(403).send('Access Denied');
    }
    try {
        const logs = await db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
        res.render('settings/audit', { title: 'Audit Logs', logs });
    } catch (err) {
        console.error('Audit Log Error:', err);
        res.status(500).send('Database Error');
    }
};

const getAcademicReports = async (req, res) => {
    const user = req.session.staff;
    try {
        const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';

        let classPerf;
        if (user.role === 'Admin') {
            classPerf = await db.all(`
                SELECT c.name as class_name, AVG(r.total) as avg_score, COUNT(r.id) as result_count
                FROM classes c
                JOIN student_enrollments se ON c.id = se.class_id AND se.session = ?
                JOIN results r ON se.student_id = r.student_id AND se.session = r.session
                GROUP BY c.id, c.name
            `, [currentSession]);
        } else {
            classPerf = await db.all(`
                SELECT c.name as class_name, AVG(r.total) as avg_score, COUNT(r.id) as result_count
                FROM classes c
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                JOIN student_enrollments se ON c.id = se.class_id AND se.session = ?
                JOIN results r ON se.student_id = r.student_id AND se.session = r.session
                WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
                GROUP BY c.id, c.name
            `, [user.id, user.id, currentSession, user.id]);
        }
        res.render('reports/academic', { title: 'Academic Reports', classPerf });
    } catch (err) {
        console.error('Academic Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStudentReports = async (req, res) => {
    try {
        const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';

        const totalStudents = await db.get("SELECT count(*) as count FROM students WHERE status='active'");
        const genderDist = await db.all("SELECT gender, count(*) as count FROM students WHERE status='active' GROUP BY gender");
        const classDist = await db.all(`
            SELECT c.name, count(se.student_id) as count
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN students s ON se.student_id = s.id
            WHERE s.status='active' AND se.session = ?
            GROUP BY c.id, c.name
        `, [currentSession]);
        const recentAdmissions = await db.all(`
            SELECT first_name, last_name, admission_number, admission_date 
            FROM students 
            WHERE status='active' 
            ORDER BY admission_date DESC 
            LIMIT 5
        `);
        res.render('reports/students', {
            title: 'Student Demographics',
            stats: { total: totalStudents.count, gender: genderDist, classes: classDist, recent: recentAdmissions }
        });
    } catch (err) {
        console.error('Student Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getAttendanceReports = async (req, res) => {
    try {
        const attendanceStats = await db.all(`
            SELECT c.name as class_name, 
                   count(CASE WHEN a.status='Present' THEN 1 END) as present_count,
                   count(a.id) as total_records
            FROM attendance a
            JOIN classes c ON a.class_id = c.id
            GROUP BY c.id
        `);
        res.render('reports/attendance', { title: 'Attendance Reports', stats: attendanceStats });
    } catch (err) {
        console.error('Attendance Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getFeeReports = async (req, res) => {
    try {
        const feeStats = await db.get(`
            SELECT 
                SUM(total_amount) as expected, 
                SUM(paid_amount) as collected, 
                SUM(total_amount - paid_amount) as outstanding 
            FROM student_fees
        `);
        const categoryStats = await db.all(`
             SELECT fc.name, SUM(sf.total_amount) as expected, SUM(sf.paid_amount) as collected
             FROM student_fees sf
             JOIN fee_categories fc ON sf.fee_category_id = fc.id
             GROUP BY fc.id
        `);

        const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';

        const debtors = await db.all(`
            SELECT s.id, s.first_name, s.last_name, s.admission_number,
                   SUM(sf.total_amount) as total_owed,
                   SUM(sf.paid_amount) as total_paid,
                   SUM(sf.total_amount - sf.paid_amount) as outstanding
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number
            HAVING SUM(sf.total_amount - sf.paid_amount) > 0
            ORDER BY outstanding DESC
        `);

        if (debtors.length > 0) {
            const studentIds = debtors.map(d => d.id);
            const placeholders = studentIds.map(() => '?').join(',');
            const enrollments = await db.all(`
                SELECT se.student_id, c.name as class_name
                FROM student_enrollments se
                JOIN classes c ON se.class_id = c.id
                WHERE se.student_id IN (${placeholders}) AND se.session = ?
            `, [...studentIds, currentSession]);

            const classMap = new Map();
            enrollments.forEach(e => {
                if (!classMap.has(e.student_id)) {
                    classMap.set(e.student_id, []);
                }
                classMap.get(e.student_id).push(e.class_name);
            });

            debtors.forEach(d => {
                const classes = classMap.get(d.id) || [];
                d.class_name = classes.length > 0 ? classes.join(', ') : 'Not Enrolled';
            });
        }

        res.render('reports/fees', {
            title: 'Fee Collection Reports',
            overall: feeStats,
            categories: categoryStats,
            debtors
        });
    } catch (err) {
        console.error('Fee Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStaffReports = async (req, res) => {
    try {
        const staffList = await db.all(`
            SELECT s.first_name, s.last_name, s.designation, count(sa.id) as subjects_count
            FROM staff s
            LEFT JOIN subject_assignments sa ON s.id = sa.teacher_id
            WHERE s.status != 'inactive'
            GROUP BY s.id
        `);
        res.render('reports/staff', { title: 'Staff Reports', staff: staffList });
    } catch (err) {
        console.error('Staff Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getHealthReports = async (req, res) => {
    try {
        const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';

        const students = await db.all(`
            SELECT s.id, s.first_name, s.last_name, s.admission_number, s.parent_phone, s.parent_address
            FROM students s
            WHERE s.status='active'
        `);

        if (students.length > 0) {
            const enrollments = await db.all(`
                SELECT se.student_id, c.name as class_name
                FROM student_enrollments se
                JOIN classes c ON se.class_id = c.id
                WHERE se.session = ?
            `, [currentSession]);

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
