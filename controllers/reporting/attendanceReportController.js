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
    const { class_id, date, type = 'Absent' } = req.query;
    const selectedSectionId = req.query.section_id ? Number(req.query.section_id) : null;
    try {
        const sections = await db.all('SELECT id, name FROM sections WHERE school_id = ? ORDER BY name', [schoolId]);
        const selectedSection = selectedSectionId
            ? sections.find(section => Number(section.id) === selectedSectionId) || null : null;
        if (selectedSectionId && !selectedSection) return res.status(400).send('The selected section does not belong to this school.');
        const classes = selectedSection
            ? await db.all('SELECT id, name FROM classes WHERE school_id = ? AND section_id = ? ORDER BY name', [schoolId, selectedSectionId])
            : [];
        let students = [];
        if (selectedSection && date) {
            if (!['Present', 'Absent', 'Late', 'Leave'].includes(type)) throw new Error('Select a valid attendance status.');
            const params = [schoolId, selectedSectionId, date, type];
            let classFilter = '';
            if (class_id) { classFilter = ' AND a.class_id = ?'; params.push(Number(class_id)); }
            students = await db.all(`SELECT s.first_name, s.last_name, s.admission_number, s.parent_phone,
                    c.name AS class_name, a.status, a.date, NULL AS time_marked
                FROM attendance a
                JOIN students s ON s.id = a.student_id AND s.school_id = ?
                JOIN classes c ON c.id = a.class_id AND c.school_id = s.school_id AND c.section_id = a.section_id
                JOIN attendance_registers ar
                  ON ar.school_id = s.school_id AND ar.section_id = a.section_id
                 AND ar.class_id = a.class_id AND ar.attendance_date = a.date
                 AND ar.session = a.session AND ar.term = a.term AND ar.status = 'submitted'
                WHERE a.section_id = ? AND a.date = ? AND a.status = ?${classFilter}
                ORDER BY c.name, s.last_name, s.first_name`, params);
        }
        return res.render('reports/attendance/daily', {
            title: 'Daily Attendance', classes, sections, selectedSection, selectedSectionId,
            students, user, query: { class_id, date, type, section_id: selectedSectionId }
        });
    } catch (err) {
        console.error('Daily Attendance Error:', err);
        return res.status(400).send(err.message || 'Unable to generate daily attendance report.');
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

            const clazz = await db.get(`SELECT c.name, c.section_id
                FROM classes c WHERE c.id = ? AND c.school_id = ?`, [class_id, schoolId]);
            if (!clazz || !clazz.section_id) throw new Error('Select a valid class linked to a section.');

            // A monthly register includes only dated placements and rows from formally submitted registers.
            const students = await db.all(`
                SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number
                FROM students s
                JOIN student_enrollment_periods ep
                  ON ep.student_id = s.id AND ep.school_id = s.school_id
                WHERE s.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
                  AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
                ORDER BY s.last_name, s.first_name
            `, [schoolId, clazz.section_id, class_id, endDate, startDate]);

            const attendance = await db.all(`
                SELECT a.student_id, a.date, a.status
                FROM attendance a
                JOIN students s ON s.id = a.student_id AND s.school_id = ?
                JOIN attendance_registers ar
                  ON ar.school_id = s.school_id AND ar.section_id = a.section_id
                 AND ar.class_id = a.class_id AND ar.attendance_date = a.date
                 AND ar.session = a.session AND ar.term = a.term
                 AND ar.status = 'submitted'
                WHERE a.class_id = ? AND a.section_id = ?
                  AND a.date BETWEEN ? AND ?
            `, [schoolId, class_id, clazz.section_id, startDate, endDate]);

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
    const selectedSectionId = req.query.section_id ? Number(req.query.section_id) : null;
    const activeThreshold = req.query.threshold === undefined || req.query.threshold === '' ? 75 : Number(req.query.threshold);
    const sections = await db.all('SELECT id, name, current_session, current_term FROM sections WHERE school_id = ? ORDER BY name', [schoolId]);
    let students = [];
    let selectedSection = null;
    let reportContext = null;
    let reportError = null;
    try {
        if (!Number.isFinite(activeThreshold) || activeThreshold < 0 || activeThreshold > 100) {
            throw new Error('Attendance threshold must be between 0 and 100.');
        }
        if (selectedSectionId) {
            selectedSection = sections.find(section => Number(section.id) === selectedSectionId) || null;
            if (!selectedSection) return res.status(400).send('The selected section does not belong to this school.');
            if (!selectedSection.current_session || !selectedSection.current_term) {
                throw new Error('Configure the selected section’s current session and term first.');
            }
            const period = await db.get(`SELECT start_date, end_date FROM section_academic_periods
                WHERE school_id = ? AND section_id = ? AND session = ? AND term = ? LIMIT 1`,
            [schoolId, selectedSectionId, selectedSection.current_session, selectedSection.current_term]);
            if (!period) throw new Error('No academic date range is configured for this section and term.');
            const classes = await db.all('SELECT id, name FROM classes WHERE school_id = ? AND section_id = ? ORDER BY name',
                [schoolId, selectedSectionId]);
            const roster = await db.all(`SELECT DISTINCT st.id, st.first_name, st.last_name, st.admission_number,
                    c.id AS class_id, c.name AS class_name
                FROM students st
                JOIN student_enrollment_periods ep ON ep.student_id = st.id AND ep.school_id = st.school_id
                JOIN classes c ON c.id = ep.class_id AND c.school_id = ep.school_id AND c.section_id = ep.section_id
                WHERE st.school_id = ? AND ep.section_id = ? AND ep.session = ?
                  AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
                ORDER BY c.name, st.last_name, st.first_name`,
            [schoolId, selectedSectionId, selectedSection.current_session, period.end_date, period.start_date]);
            const analytics = require('../../services/attendanceAnalyticsService');
            for (const student of roster) {
                const result = await analytics.calculate({
                    schoolId, sectionId: selectedSectionId, classId: Number(student.class_id),
                    studentId: Number(student.id), session: selectedSection.current_session,
                    term: selectedSection.current_term, startDate: String(period.start_date).slice(0,10),
                    endDate: String(period.end_date).slice(0,10), lowAttendanceThreshold: activeThreshold
                });
                if (result.lowAttendance) students.push({
                    ...student, expected_days: result.counts.expected, recorded_days: result.counts.recorded,
                    present_days: result.counts.present, late_days: result.counts.late,
                    leave_days: result.counts.approvedLeave, absent_days: result.counts.absent,
                    missing_registers: result.counts.missingRegister, draft_registers: result.counts.draftRegister,
                    attendance_rate: result.attendanceRate
                });
            }
            reportContext = { session: selectedSection.current_session, term: selectedSection.current_term,
                start_date: String(period.start_date).slice(0,10), end_date: String(period.end_date).slice(0,10) };
        }
        return res.render('reports/attendance/low', {
            title: 'Low Attendance Alerts', students, user, sections, selectedSection,
            selectedSectionId, threshold: activeThreshold, reportContext, reportError
        });
    } catch (err) {
        console.error('Low Attendance Report Error:', err);
        reportError = err.message || 'Unable to generate low-attendance report.';
        return res.status(400).render('reports/attendance/low', {
            title: 'Low Attendance Alerts', students: [], user, sections, selectedSection,
            selectedSectionId, threshold: activeThreshold, reportContext, reportError
        });
    }
};

module.exports = {
    getAttendanceDashboard,
    getDailyAttendance,
    getRegister,
    getLowAttendance
};

