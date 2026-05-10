const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../../database.sqlite'));

const getAttendanceDashboard = (req, res) => {
    const user = req.session.staff;
    const stats = {
        total_records: db.prepare("SELECT COUNT(*) as count FROM attendance WHERE date = date('now')").get().count
    };

    res.render('reports/attendance/index', {
        title: 'Attendance Reports Dashboard',
        stats,
        user
    });
};

const getDailyAttendance = (req, res) => {
    const user = req.session.staff;
    const { class_id, date } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = db.prepare('SELECT * FROM classes').all();
    } else {
        classes = db.prepare(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `).all(user.id, user.id, user.id);
    }

    let records = [];
    if (class_id && date) {
        records = db.prepare(`
            SELECT s.first_name, s.last_name, s.admission_number, a.status, a.date
            FROM students s
            JOIN attendance a ON s.id = a.student_id
            WHERE a.class_id = ? AND a.date = ?
            ORDER BY s.last_name, s.first_name
        `).all(class_id, date);
    }

    res.render('reports/attendance/daily', {
        title: 'Daily Attendance',
        classes,
        records,
        user,
        query: { class_id, date }
    });
};

const getRegister = (req, res) => {
    const user = req.session.staff;
    const { class_id, month, year } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = db.prepare('SELECT * FROM classes').all();
    } else {
        classes = db.prepare(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `).all(user.id, user.id, user.id);
    }

    let registerData = null;
    if (class_id && month && year) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const students = db.prepare(`
            SELECT id, first_name, last_name, admission_number
            FROM students
            WHERE current_class_id = ? AND status = 'active'
            ORDER BY last_name, first_name
        `).all(class_id);

        const attendance = db.prepare(`
            SELECT student_id, date, status
            FROM attendance
            WHERE class_id = ? AND date BETWEEN ? AND ?
        `).all(class_id, startDate, endDate);

        const clazz = db.prepare('SELECT name FROM classes WHERE id = ?').get(class_id);

        const formattedStudents = students.map(s => {
            const studentAttendance = {};
            let present = 0, absent = 0, late = 0;

            attendance.filter(a => a.student_id === s.id).forEach(a => {
                const day = new Date(a.date).getDate();
                studentAttendance[day] = a.status;
                if (a.status === 'Present') present++;
                else if (a.status === 'Absent') absent++;
                else if (a.status === 'Late') late++;
            });

            return {
                ...s,
                attendance: studentAttendance,
                summary: { present, absent, late }
            };
        });

        registerData = {
            class_name: clazz ? clazz.name : '',
            days,
            students: formattedStudents
        };
    }

    res.render('reports/attendance/register', {
        title: 'Attendance Register',
        classes,
        registerData,
        user,
        query: { class_id, month, year }
    });
};

const getLowAttendance = (req, res) => {
    const user = req.session.staff;
    const { term, session, threshold } = req.query;
    const activeThreshold = threshold || 75;

    let students = [];
    if (term && session) {
        students = db.prepare(`
            SELECT 
                s.first_name, s.last_name, s.admission_number, c.name as class_name,
                SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_days,
                COUNT(a.id) as total_days,
                ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(a.id) * 100, 1) as percentage
            FROM students s
            JOIN classes c ON s.current_class_id = c.id
            JOIN attendance a ON s.id = a.student_id
            WHERE a.term = ? AND a.session = ?
            GROUP BY s.id
            HAVING percentage < ? AND total_days > 0
            ORDER BY percentage ASC
        `).all(term, session, activeThreshold);
    }

    res.render('reports/attendance/low', {
        title: 'Low Attendance Alerts',
        students,
        user,
        query: { term, session, threshold: activeThreshold }
    });
}

module.exports = {
    getAttendanceDashboard,
    getDailyAttendance,
    getRegister,
    getLowAttendance
};
