const db = require('../utils/db');
const { logAction } = require('../utils/logger');
const { getEnrolledStudents } = require('../utils/enrollmentHelper');
const sessionHelper = require('../utils/sessionHelper');
const { buildWhatsAppAttendanceAction } = require('../utils/whatsappHelper');

// Helper: get classes assigned to a staff member
const getAssignedClasses = async (user, schoolId) => {
    if (!schoolId) return [];
    if (user.role === 'Admin') {
        return await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
    }
    const staffId = Number(user.id);
    return await db.all(`
        SELECT DISTINCT c.* 
        FROM classes c
        LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
        LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
        WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
          AND c.school_id = ?
        ORDER BY c.name ASC
    `, [staffId, staffId, staffId, schoolId]);
};

// Helper: get current academic settings (section-aware)
const getAcademicSettings = async (class_id = null, schoolId) => {
    if (class_id && schoolId) {
        const sec = await db.get(`
            SELECT s.current_session, s.current_term 
            FROM sections s 
            JOIN classes c ON c.section_id = s.id 
            WHERE c.id = ? AND c.school_id = ?
        `, [class_id, schoolId]);
        if (sec && sec.current_session && sec.current_term) {
            return { session: sec.current_session, term: sec.current_term };
        }
    }
    const session = schoolId ? await sessionHelper.getCurrentSession(schoolId) : null;
    const term = schoolId ? await sessionHelper.getCurrentTerm(schoolId) : null;
    return {
        session: session || null,
        term: term || null
    };
};

// GET /attendance - Attendance index/dashboard
const getIndex = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const user = req.session.staff;
        const classes = await getAssignedClasses(user, schoolId);

        const limitRow = await db.get(
            "SELECT value FROM settings WHERE key = 'attendance.term_absence_limit' AND school_id = ? ORDER BY school_id DESC LIMIT 1",
            [schoolId]
        );
        const termAbsenceLimit = Number(limitRow ? limitRow.value : 10);

        const consecutiveRow = await db.get(
            "SELECT value FROM settings WHERE key = 'attendance.consecutive_absence_limit' AND school_id = ? ORDER BY school_id DESC LIMIT 1",
            [schoolId]
        );
        const consecutiveAbsenceLimit = Number(consecutiveRow ? consecutiveRow.value : 3);
const schoolInfo = await db.get('SELECT name, phone FROM schools WHERE id = ?', [schoolId]);

        const flaggedStudents = {};
        for (const cls of classes) {
            const academicSettings = await getAcademicSettings(cls.id, schoolId);

            const attendanceRecords = await db.all(`
                SELECT a.student_id, a.status, a.date, s.first_name, s.last_name, s.parent_phone, a.reason
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                WHERE a.class_id = ? AND a.term = ? AND a.session = ?
                ORDER BY a.student_id, a.date ASC
            `, [cls.id, academicSettings.term, academicSettings.session]);

            const studentStats = {};
            for (const record of attendanceRecords) {
                if (!studentStats[record.student_id]) {
                                            studentStats[record.student_id] = {
                            id: record.student_id,
                            first_name: record.first_name,
                            last_name: record.last_name,
                            parent_phone: record.parent_phone,
                            total_absent_days: 0,
                            longest_consecutive_absent_days: 0,
                            current_consecutive_absent_days: 0,
                            current_streak: 0,
                            absences_without_reason: 0
                        };
                }

                const stats = studentStats[record.student_id];

                if (record.status === 'Absent') {
                    stats.total_absent_days++;
                    stats.current_streak++;
                    // Update current consecutive absent days
                    stats.current_consecutive_absent_days = stats.current_streak;
                    // Update longest consecutive absent days if this streak is greater
                    if (stats.current_streak > stats.longest_consecutive_absent_days) {
                        stats.longest_consecutive_absent_days = stats.current_streak;
                    }
                    if (!record.reason || record.reason.trim() === '' || record.reason === 'Unknown') {
                        stats.absences_without_reason++;
                    }
                } else if (record.status === 'Present' || record.status === 'Late') {
                    // Reset current streak on presence or lateness
                    stats.current_streak = 0;
                    stats.current_consecutive_absent_days = 0;
                }
            }

            // Determine flagged students based on total and current consecutive absences
            const flagged = Object.values(studentStats).filter(s => {
                s.flag_reason = [];
                if (s.total_absent_days >= termAbsenceLimit) {
                    s.flag_reason.push(`Term Limit: ${s.total_absent_days} absences`);
                }
                if (s.current_consecutive_absent_days >= consecutiveAbsenceLimit) {
                    s.flag_reason.push(`Consecutive: ${s.current_consecutive_absent_days} days`);
                }
                return s.flag_reason.length > 0;
            });

            // Generate WhatsApp contact details for each flagged student
            flagged.forEach(st => {
                const wa = buildWhatsAppAttendanceAction({
                    parent_phone: st.parent_phone,
                    total_absences: st.total_absent_days,
                    consecutive_absences: st.current_consecutive_absent_days,
                    term_limit: termAbsenceLimit,
                    consecutive_limit: consecutiveAbsenceLimit,
                    context: {
                        student_name: `${st.first_name} ${st.last_name}`,
                        class_name: cls.name,
                        term: academicSettings.term,
                        session: academicSettings.session,
                        school_name: schoolInfo.name,
                        school_phone: schoolInfo.phone
                    }
                });
                st.whatsapp_url = wa.whatsapp_url;
                st.whatsapp_phone = wa.display_phone;
                st.whatsapp_message = wa.message;
                st.has_valid_whatsapp = wa.is_valid;
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

    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user, schoolId);
            const hasAccess = assignedClasses.some(c => String(c.id) === String(class_id));
            if (!hasAccess) return res.redirect('/attendance?error=Access Denied');
        }

        const clazz = await db.get('SELECT * FROM classes WHERE id = ? AND school_id = ?', [Number(class_id), schoolId]);
        if (!clazz) return res.redirect('/attendance?error=Class not found');

        const settings = await getAcademicSettings(Number(class_id), schoolId);

        const enrolledStudents = await getEnrolledStudents(Number(class_id), settings.session);
        let students = [];
        if (enrolledStudents.length > 0) {
            const studentIds = enrolledStudents.map(s => Number(s.id));
            students = await db.all(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number, s.passport_photo_path,
                       a.status
                FROM students s
                LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ? AND a.class_id = ?
                WHERE s.id IN (${studentIds.map(() => '?').join(',')})
                  AND s.school_id = ?
                ORDER BY s.last_name, s.first_name
            `, [date, Number(class_id), ...studentIds, schoolId]);
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Session expired' });
    }

    try {
        const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [Number(class_id), schoolId]);
        if (!classCheck) return res.status(403).json({ success: false, message: 'Class not found or access denied' });

        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user, schoolId);
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

                // Validate student belongs to tenant
                const studentCheck = await db.get('SELECT id FROM students WHERE id = ? AND school_id = ?', [student_id, schoolId]);
                if (!studentCheck) continue;

                const settings = await getAcademicSettings(class_id, schoolId);
                
                const rawReason = reasons[studentIdStr] || null;
                const customReason = custom_reasons[studentIdStr] || null;
                
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
                `, [Number(class_id), start_date, end_date]);
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
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
            WHERE s.school_id = ?
            ORDER BY s.last_name, s.first_name
        `, [targetDate, schoolId]);

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

