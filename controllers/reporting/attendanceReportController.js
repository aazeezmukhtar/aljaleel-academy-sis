const db = require('../../utils/db');

const getAttendanceDashboard = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const selectedSectionId = req.query.section_id ? Number(req.query.section_id) : null;
    const stats = { present_today: 0, absent_today: 0, late_today: 0, leave_today: 0, submitted_registers: 0, expected_registers: 0 };
    let selectedSection = null;
    try {
        const sections = await db.all('SELECT id, name, current_session, current_term FROM sections WHERE school_id = ? ORDER BY name', [schoolId]);
        if (selectedSectionId) {
            selectedSection = sections.find(section => Number(section.id) === selectedSectionId) || null;
            if (!selectedSection) return res.status(400).send('The selected section does not belong to this school.');
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
            if (selectedSection.current_session && selectedSection.current_term) {
                const classes = await db.all('SELECT id, section_id FROM classes WHERE school_id = ? AND section_id = ? ORDER BY id', [schoolId, selectedSectionId]);
                const analytics = require('../../services/attendanceAnalyticsService');
                for (const cls of classes) {
                    const roster = await db.all(`SELECT DISTINCT st.id
                        FROM students st JOIN student_enrollment_periods ep
                          ON ep.student_id = st.id AND ep.school_id = st.school_id
                        WHERE st.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
                          AND ep.session = ? AND ep.start_date <= ?
                          AND (ep.end_date IS NULL OR ep.end_date >= ?)`,
                    [schoolId, selectedSectionId, cls.id, selectedSection.current_session, today, today]);
                    for (const student of roster) {
                        const result = await analytics.calculate({
                            schoolId, sectionId: selectedSectionId, classId: Number(cls.id),
                            studentId: Number(student.id), session: selectedSection.current_session,
                            term: selectedSection.current_term, startDate: today, endDate: today,
                            lowAttendanceThreshold: 75
                        });
                        for (const day of result.days) {
                            if (day.status === 'recorded') {
                                if (day.attendanceStatus === 'Present') stats.present_today += 1;
                                else if (day.attendanceStatus === 'Absent') stats.absent_today += 1;
                                else if (day.attendanceStatus === 'Late') stats.late_today += 1;
                                else if (day.attendanceStatus === 'Leave') stats.leave_today += 1;
                            }
                        }
                    }
                }
                const registerStats = await db.get(`SELECT
                    COUNT(*) AS submitted_registers
                    FROM attendance_registers
                    WHERE school_id = ? AND section_id = ? AND attendance_date = ?
                      AND session = ? AND term = ? AND status = 'submitted'`,
                [schoolId, selectedSectionId, today, selectedSection.current_session, selectedSection.current_term]);
                stats.submitted_registers = Number(registerStats ? registerStats.submitted_registers : 0);
                stats.expected_registers = classes.length;
            }
        }
        return res.render('reports/attendance/index', {
            title: 'Attendance Reports Dashboard', stats, user, sections,
            selectedSection, selectedSectionId
        });
    } catch (err) {
        console.error('Attendance Dashboard Error:', err);
        return res.status(500).send('Unable to generate the attendance dashboard.');
    }
};

const getDailyAttendance = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const { class_id, date } = req.query;
    try {
        const classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
        let records = [];
        if (class_id && date) {
            records = await db.all(`
                SELECT s.first_name, s.last_name, s.admission_number,
                       a.status, a.date, a.section_id
                FROM students s
                JOIN attendance a ON s.id = a.student_id
                WHERE a.class_id = ? AND a.date = ?
                  AND s.school_id = ?
                ORDER BY s.last_name, s.first_name
            `, [class_id, date, schoolId]);
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
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const { class_id, month, year } = req.query;

    try {
        const classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);

        let registerData = {
            class_name: '',
            days: [],
            students: []
        };

        if (class_id && month && year) {
            const daysInMonth = new Date(year, month, 0).getDate();
            const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

            // Build the historical class roster from dated placement periods.
            // Also retain students with actual attendance in the requested month,
            // including legacy rows whose original placement dates are unknown.
            const students = await db.all(`
                SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number
                FROM students s
                WHERE s.school_id = ?
                  AND (
                    EXISTS (
                      SELECT 1
                      FROM student_enrollment_periods ep
                      WHERE ep.student_id = s.id
                        AND ep.school_id = s.school_id
                        AND ep.class_id = ?
                        AND ep.start_date <= ?
                        AND (ep.end_date IS NULL OR ep.end_date >= ?)
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM attendance a_legacy
                      WHERE a_legacy.student_id = s.id
                        AND a_legacy.class_id = ?
                        AND a_legacy.date BETWEEN ? AND ?
                    )
                  )
                ORDER BY s.last_name, s.first_name
            `, [schoolId, class_id, endDate, startDate, class_id, startDate, endDate]);

            const attendance = await db.all(`
                SELECT a.student_id, a.date, a.status
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                WHERE a.class_id = ? AND a.date BETWEEN ? AND ?
                  AND s.school_id = ?
            `, [class_id, startDate, endDate, schoolId]);

            const clazz = await db.get('SELECT name FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);

            const attendanceByStudent = new Map();
            (attendance || []).forEach(row => {
                const key = String(row.student_id);
                if (!attendanceByStudent.has(key)) attendanceByStudent.set(key, []);
                attendanceByStudent.get(key).push(row);
            });

            const formattedStudents = (students || []).map(s => {
                const studentAttendance = {};
                let present = 0, absent = 0, late = 0;
                (attendanceByStudent.get(String(s.id)) || []).forEach(a => {
                    // Parse the database date as a calendar date, not a UTC timestamp.
                    const day = Number(String(a.date).slice(8, 10));
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
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const { term, session, threshold } = req.query;
    const activeThreshold = threshold || 75;
    try {
        let students = [];
        if (term && session) {
            const lowAttendanceSql = db.DB_TYPE === 'postgres'
                ? `SELECT
                    s.first_name, s.last_name, s.admission_number, c.name as class_name, c.section_id,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_days,
                    COUNT(a.id) as total_days,
                    ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS NUMERIC) / NULLIF(COUNT(a.id),0) * 100,1) as percentage
                FROM students s
                JOIN attendance a ON s.id = a.student_id
                JOIN classes c ON a.class_id = c.id
                WHERE a.term = $1 AND a.session = $2 AND s.school_id = $4
                GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name, c.section_id, a.class_id
                HAVING ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS NUMERIC) / NULLIF(COUNT(a.id),0) * 100,1) < $3
                AND COUNT(a.id) > 0
                ORDER BY percentage ASC`
                : `SELECT
                    s.first_name, s.last_name, s.admission_number, c.name as class_name,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_days,
                    COUNT(a.id) as total_days,
                    ROUND(CAST(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(a.id) * 100, 1) as percentage
                FROM students s
                JOIN attendance a ON s.id = a.student_id
                JOIN classes c ON a.class_id = c.id
                WHERE a.term = ? AND a.session = ? AND s.school_id = ?
                GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name, a.class_id
                HAVING percentage < ? AND total_days > 0
                ORDER BY percentage ASC`;
            students = await db.all(lowAttendanceSql, db.DB_TYPE === 'postgres' ? [term, session, activeThreshold, schoolId] : [term, session, schoolId, activeThreshold]);
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

