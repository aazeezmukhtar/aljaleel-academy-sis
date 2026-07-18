const db = require('../utils/db');
const { logAction } = require('../utils/logger');
const { getEnrolledStudents } = require('../utils/enrollmentHelper');

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

// Helper: get current academic settings (section-aware)
const getAcademicSettings = async (class_id = null) => {
    // If a class is provided, derive term/session from its section
    if (class_id) {
        const sec = await db.get(`
            SELECT s.current_session, s.current_term 
            FROM sections s 
            JOIN classes c ON c.section_id = s.id 
            WHERE c.id = ?
        `, [class_id]);
        if (sec && sec.current_session && sec.current_term) {
            return { session: sec.current_session, term: sec.current_term };
        }
    }
    // Fallback to global settings
    const school = await db.all('SELECT key, value FROM settings');
    const settings = {};
    school.forEach(s => settings[s.key] = s.value);
    return {
        session: settings.current_session || '2024/2025',
        term: settings.current_term || '1st Term'
    };
};

// GET /attendance - Attendance index/dashboard
const getIndex = async (req, res) => {
    try {
        const user = req.session.staff;
        const classes = await getAssignedClasses(user);

        // Fetch thresholds from settings
        const limitRow = await db.get("SELECT value FROM settings WHERE key = 'attendance.term_absence_limit'");
        const termAbsenceLimit = Number(limitRow ? limitRow.value : 10);

        const consecutiveRow = await db.get("SELECT value FROM settings WHERE key = 'attendance.consecutive_absence_limit'");
        const consecutiveAbsenceLimit = Number(consecutiveRow ? consecutiveRow.value : 3);

        // Prepare flagged students list per class (uses per-section term/session)
        const flaggedStudents = {};
        for (const cls of classes) {
            // Use section-aware academic settings so term/session match what was recorded
            const academicSettings = await getAcademicSettings(cls.id);

            // Fetch all student attendance records for this class & term/session
            const attendanceRecords = await db.all(`
                SELECT a.student_id, a.status, a.date, a.reason, s.first_name, s.last_name, s.parent_phone
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                WHERE a.class_id = ? AND a.term = ? AND a.session = ?
                ORDER BY a.student_id, a.date ASC
            `, [cls.id, academicSettings.term, academicSettings.session]);

            // Group by student and evaluate consecutive absences
            const studentStats = {};
            for (const record of attendanceRecords) {
                if (!studentStats[record.student_id]) {
                    studentStats[record.student_id] = {
                        id: record.student_id,
                        first_name: record.first_name,
                        last_name: record.last_name,
                        parent_phone: record.parent_phone,
                        total_absent_days: 0,
                        consecutive_absent_days: 0,
                        current_streak: 0,
                        absences_without_reason: 0
                    };
                }

                const stats = studentStats[record.student_id];

                if (record.status === 'Absent') {
                    stats.total_absent_days++;
                    stats.current_streak++;
                    if (stats.current_streak > stats.consecutive_absent_days) {
                        stats.consecutive_absent_days = stats.current_streak;
                    }
                    if (!record.reason || record.reason.trim() === '' || record.reason === 'Unknown') {
                        stats.absences_without_reason++;
                    }
                } else if (record.status === 'Present' || record.status === 'Late') {
                    stats.current_streak = 0;
                }
                // 'Leave' status is ignored (does not count as absent, nor breaks consecutive streak)
            }

            // Filter students meeting either threshold
            const flagged = Object.values(studentStats).filter(s => {
                s.flag_reason = [];
                if (s.total_absent_days >= termAbsenceLimit) {
                    s.flag_reason.push(`Term Limit: ${s.total_absent_days} absences`);
                }
                if (s.consecutive_absent_days >= consecutiveAbsenceLimit) {
                    s.flag_reason.push(`Consecutive: ${s.consecutive_absent_days} absences`);
                }
                return s.flag_reason.length > 0;
            });

            if (flagged.length > 0) {
                flaggedStudents[cls.id] = { class: cls, students: flagged };
            }
        }
        res.render('attendance/index', {
            title: 'Attendance Management',
            classes,
            user,
            flaggedStudents,
            termAbsenceLimit,
            consecutiveAbsenceLimit
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

        const settings = await getAcademicSettings(class_id);

        // Use centralized helper (handles student_enrollments + current_class_id fallback + case-insensitive status)
        const enrolledStudents = await getEnrolledStudents(class_id, settings.session);
        let students = [];
        if (enrolledStudents.length > 0) {
            const studentIds = enrolledStudents.map(s => Number(s.id));
            students = await db.all(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number, s.passport_photo_path,
                       a.status
                FROM students s
                LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ? AND a.class_id = ?
                WHERE s.id IN (${studentIds.map(() => '?').join(',')})
                ORDER BY s.last_name, s.first_name
            `, [date, Number(class_id), ...studentIds]);
        }

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
    const { class_id, date, session, term, attendance, reasons = {}, custom_reasons = {} } = req.body;
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
            INSERT INTO attendance (student_id, class_id, date, status, session, term, reason, reason_type, custom_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, date, session, term)
            DO UPDATE SET status = excluded.status, class_id = excluded.class_id, 
                          reason = excluded.reason, reason_type = excluded.reason_type, 
                          custom_reason = excluded.custom_reason
        `;

        await db.transaction(async () => {
            for (const [studentIdStr, status] of Object.entries(attendance || {})) {
                const student_id = Number(studentIdStr);
                if (isNaN(student_id)) continue;
                const settings = await getAcademicSettings(class_id);
                
                const rawReason = reasons[studentIdStr] || null;
                const customReason = custom_reasons[studentIdStr] || null;
                
                // Set main reason text
                let reason = rawReason;
                if (rawReason === 'Other' && customReason) {
                    reason = customReason;
                }
                
                await db.run(sql, [
                    student_id,
                    Number(class_id),
                    date,
                    status,
                    session || settings.session,
                    term || settings.term,
                    reason,
                    rawReason,
                    customReason
                ]);
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
