const db = require('../utils/db');
const { logAction } = require('../utils/logger');

// Helper: get classes assigned to a staff member
const getAssignedClasses = async (user) => {
    if (user.role === 'Admin') {
        return await db.all('SELECT * FROM classes ORDER BY name ASC');
    }
    return await db.all(`
        SELECT DISTINCT c.* 
        FROM classes c
        LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
        LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
        WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
        ORDER BY c.name ASC
    `, [user.id, user.id, user.id]);
};

// Helper: get current academic settings
const getAcademicSettings = async () => {
    const school = await db.all('SELECT key, value FROM settings');
    const settings = {};
    school.forEach(s => settings[s.key] = s.value);
    return {
        session: settings.current_session || '2025/2026',
        term: settings.current_term || 'First Term'
    };
};

// GET /attendance - Attendance index/dashboard
const getIndex = async (req, res) => {
    try {
        const user = req.session.staff;
        const classes = await getAssignedClasses(user);
        res.render('attendance/index', {
            title: 'Attendance Management',
            classes,
            user
        });
    } catch (err) {
        console.error('Attendance Index Error:', err);
        res.status(500).send('Database Error');
    }
};

// GET /attendance/take - Show attendance marking form
const getTakeAttendance = async (req, res) => {
    const { class_id, date } = req.query;
    const user = req.session.staff;

    if (!class_id || !date) {
        return res.redirect('/attendance');
    }

    try {
        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user);
            const hasAccess = assignedClasses.some(c => String(c.id) === String(class_id));
            if (!hasAccess) return res.redirect('/attendance?error=Access Denied');
        }

        const clazz = await db.get('SELECT * FROM classes WHERE id = ?', [class_id]);
        if (!clazz) return res.redirect('/attendance?error=Class not found');

        const students = await db.all(`
            SELECT s.id, s.first_name, s.last_name, s.admission_number, s.passport_photo_path,
                   a.status
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ? AND a.class_id = ?
            WHERE s.current_class_id = ? AND s.status = 'active'
            ORDER BY s.last_name, s.first_name
        `, [date, class_id, class_id]);

        const settings = await getAcademicSettings();

        res.render('attendance/take', {
            title: 'Mark Attendance',
            clazz,
            class_id,
            date,
            students,
            currentTerm: settings.term,
            currentSession: settings.session
        });
    } catch (err) {
        console.error('getTakeAttendance Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /attendance/save - Save student attendance records
const saveAttendance = async (req, res) => {
    const { class_id, date, session, term, attendance } = req.body;
    const user = req.session.staff;

    if (!user) {
        return res.status(401).json({ success: false, message: 'Session expired' });
    }

    try {
        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user);
            const hasAccess = assignedClasses.some(c => String(c.id) === String(class_id));
            if (!hasAccess) return res.status(403).json({ success: false, message: 'Access Denied to this class' });
        }

        const sql = `
            INSERT INTO attendance (student_id, class_id, date, status, session, term)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, date, session, term) DO UPDATE SET status = excluded.status, class_id = excluded.class_id
        `;

        await db.transaction(async () => {
            for (const [studentIdStr, status] of Object.entries(attendance || {})) {
                const student_id = Number(studentIdStr);
                if (isNaN(student_id)) continue;
                await db.run(sql, [student_id, Number(class_id), date, status, session || '2025/2026', term || 'First Term']);
            }
        });

        logAction(user.id, 'SAVE_ATTENDANCE', 'ATTENDANCE', {
            class_id, date, count: Object.keys(attendance || {}).length
        }, req.ip);

        return res.json({ success: true, message: 'Attendance saved successfully' });
    } catch (err) {
        console.error('saveAttendance Error:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Database Error', 
            error: err.message
        });
    }
};

// GET /attendance/report - Attendance summary report
const getReport = async (req, res) => {
    const { class_id, start_date, end_date } = req.query;
    const user = req.session.staff;

    try {
        const classes = await getAssignedClasses(user);
        let reportData = null;

        if (class_id && start_date && end_date) {
            if (user.role !== 'Admin') {
                const hasAccess = classes.some(c => String(c.id) === String(class_id));
                if (!hasAccess) {
                    reportData = [];
                }
            }

            if (reportData === null) {
                reportData = await db.all(`
                    SELECT s.first_name, s.last_name,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent,
                    SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) as late,
                    SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END) as leave,
                    COUNT(a.id) as total_days
                    FROM students s
                    JOIN attendance a ON s.id = a.student_id
                    WHERE a.class_id = ? AND a.date BETWEEN ? AND ?
                    GROUP BY s.id
                    ORDER BY s.last_name, s.first_name
                `, [class_id, start_date, end_date]);
            }
        }

        res.render('attendance/report', {
            title: 'Attendance Report',
            classes,
            user,
            reportData,
            filters: { class_id, start_date, end_date }
        });
    } catch (err) {
        console.error('Attendance Report Error:', err);
        res.status(500).send('Database Error');
    }
};

// GET /attendance/staff - Staff attendance page (Admin only)
const getStaffAttendance = async (req, res) => {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const user = req.session.staff;

    if (user.role !== 'Admin') {
        return res.status(403).send('Access Denied: Only Administrators can manage staff attendance.');
    }

    try {
        const staffDocs = await db.all(`
            SELECT s.*, sa.status 
            FROM staff s
            LEFT JOIN staff_attendance sa ON s.id = sa.teacher_id AND sa.date = ?
            ORDER BY s.last_name, s.first_name
        `, [targetDate]);

        res.render('attendance/staff', {
            title: 'Staff Attendance',
            staff: staffDocs,
            date: targetDate
        });
    } catch (err) {
        console.error('Staff Attendance Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /attendance/staff/save - Save staff attendance (Admin only)
const saveStaffAttendance = async (req, res) => {
    const { date, session, term, attendance } = req.body;
    const user = req.session.staff;

    if (user.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const sql = `
            INSERT INTO staff_attendance (teacher_id, status, date, session, term)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(teacher_id, date, session, term) DO UPDATE SET status = excluded.status
        `;

        await db.transaction(async () => {
            for (const [teacherIdStr, status] of Object.entries(attendance)) {
                const teacher_id = Number(teacherIdStr);
                await db.run(sql, [teacher_id, status, date, session, term]);
            }
        });

        logAction(user.id, 'SAVE_STAFF_ATTENDANCE', 'ATTENDANCE', {
            date, count: Object.keys(attendance).length
        }, req.ip);
        res.json({ success: true, message: 'Staff attendance saved.' });
    } catch (err) {
        console.error('Save Staff Attendance Error:', err);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
};

module.exports = { getIndex, getTakeAttendance, saveAttendance, getReport, getStaffAttendance, saveStaffAttendance };
