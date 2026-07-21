const db = require('../../utils/db');

const getAttendanceDashboard = async (req, res) => {
    const user = req.session.staff;
    try {
        const dateSql = db.DB_TYPE === 'postgres'
            ? "SELECT COUNT(*) as count FROM attendance WHERE date = CURRENT_DATE"
            : "SELECT COUNT(*) as count FROM attendance WHERE date = date('now')";
        const statsResult = await db.get(dateSql);
        const stats = {
            total_records: statsResult ? statsResult.count : 0
        };
        res.render('reports/attendance/index', {
            title: 'Attendance Reports Dashboard',
            stats,
            user
        });
    } catch (err) {
        console.error('Attendance Dashboard Error:', err);
        res.status(500).send('Database Error');
    }
};

const getDailyAttendance = async (req, res) => {
    const user = req.session.staff;
    const { class_id, date } = req.query;
    try {
        // fetch all classes for dropdown, regardless of role
        const classes = await db.all('SELECT * FROM classes');
        let records = [];
        if (class_id && date) {
            records = await db.all(`
                SELECT s.first_name, s.last_name, s.admission_number, a.status, a.date
                FROM students s
                JOIN attendance a ON s.id = a.student_id
                WHERE a.class_id = ? AND a.date = ?
                ORDER BY s.last_name, s.first_name
            `, [class_id, date]);
        }
        res.render('reports/attendance/daily', {
            title: 'Daily Attendance',
            classes,
            records,
            user,
            query: { class_id, date }
        });
    } catch (err) {
        console.error('Daily Attendance Error:', err);
        res.status(500).send('Database Error');
    }
};

const getRegister = async (req, res) => {
    const user = req.session.staff;
    const { class_id, month, year } = req.query;

    try {
        // Fetch all classes for the register dropdown
        const classes = await db.all('SELECT * FROM classes');

        // Prepare a default empty registerData structure
        let registerData = {
            class_name: '',
            days: [],
            students: []
        };

        // Only attempt to gather data when class, month, and year are provided
        if (class_id && month && year) {
            const daysInMonth = new Date(year, month, 0).getDate();
            const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

            // Retrieve current session (fallback if not set)
                const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
                const currentSession = sessionRow ? sessionRow.value : '2024/2025';

                // First attempt to fetch students via enrollment table (handles academic classes)
                let students = await db.all(`
                    SELECT s.id, s.first_name, s.last_name, s.admission_number
                    FROM students s
                    JOIN student_enrollments se ON s.id = se.student_id
                    WHERE se.class_id = ? AND se.session = ?
                    AND s.status = 'active'
                    ORDER BY s.last_name, s.first_name
                `, [class_id, currentSession]);

                // Fallback to current_class_id if no enrollment records
                if (!students || students.length === 0) {
                    students = await db.all(`
                        SELECT id, first_name, last_name, admission_number
                        FROM students
                        WHERE current_class_id = ? AND status = 'active'
                        ORDER BY last_name, first_name
                    `, [class_id]);
                }

            const attendance = await db.all(`
                SELECT student_id, date, status
                FROM attendance
                WHERE class_id = ? AND date BETWEEN ? AND ?
            `, [class_id, startDate, endDate]);

            const clazz = await db.get('SELECT name FROM classes WHERE id = ?', [class_id]);

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
    } catch (err) {
        console.error('Attendance Register Error:', err);
        res.status(500).send('Database Error');
    }
};

const getLowAttendance = async (req, res) => {
    const user = req.session.staff;
    const { term, session, threshold } = req.query;
    const activeThreshold = threshold || 75;
    try {
        let students = [];
        if (term && session) {
            const lowAttendanceSql = db.DB_TYPE === 'postgres'
                ? `SELECT
                    s.first_name, s.last_name, s.admission_number, c.name as class_name,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_days,
                    COUNT(a.id) as total_days,
                    ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS NUMERIC) / NULLIF(COUNT(a.id),0) * 100,1) as percentage
                FROM students s
                JOIN classes c ON s.current_class_id = c.id
                JOIN attendance a ON s.id = a.student_id
                WHERE a.term = $1 AND a.session = $2
                GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
                HAVING ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS NUMERIC) / NULLIF(COUNT(a.id),0) * 100,1) < $3
                AND COUNT(a.id) > 0
                ORDER BY percentage ASC`
                : `SELECT
                    s.first_name, s.last_name, s.admission_number, c.name as class_name,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_days,
                    COUNT(a.id) as total_days,
                    ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(a.id) * 100, 1) as percentage
                FROM students s
                JOIN classes c ON s.current_class_id = c.id
                JOIN attendance a ON s.id = a.student_id
                WHERE a.term = ? AND a.session = ?
                GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
                HAVING percentage < ? AND total_days > 0
                ORDER BY percentage ASC`;
            students = await db.all(lowAttendanceSql, db.DB_TYPE === 'postgres' ? [term, session, activeThreshold] : [term, session, activeThreshold]);
        }

        res.render('reports/attendance/low', {
            title: 'Low Attendance Alerts',
            students,
            user,
            query: { term, session, threshold: activeThreshold }
        });
    } catch (err) {
        console.error('Low Attendance Report Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getAttendanceDashboard,
    getDailyAttendance,
    getRegister,
    getLowAttendance
};
