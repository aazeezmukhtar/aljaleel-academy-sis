const db = require('../utils/db');
const { logAction } = require('../utils/logger');
const { getAttendanceStudents } = require('../utils/attendanceStudentHelper');
const sessionHelper = require('../utils/sessionHelper');
const { buildWhatsAppAttendanceAction } = require('../utils/whatsappHelper');

// Helper: get classes assigned to a staff member
const getAssignedClasses = async (user, schoolId, onDate = null) => {
    if (!schoolId) return [];
    if (user.role === 'Admin') {
        return await db.all(`
            SELECT c.*, s.name AS section_name
            FROM classes c
            LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
            WHERE c.school_id = ?
            ORDER BY s.name ASC, c.name ASC
        `, [schoolId]);
    }
    const staffId = Number(user.id);
    const responsibilityDate = onDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    return await db.all(`
        SELECT DISTINCT c.*, s.name AS section_name
        FROM classes c
        LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
        LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
        LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
        WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL OR EXISTS (
            SELECT 1 FROM class_attendance_responsibilities car
            WHERE car.school_id = c.school_id AND car.class_id = c.id AND car.staff_id = ?
              AND car.effective_from <= ? AND (car.effective_to IS NULL OR car.effective_to >= ?)
        ))
          AND c.school_id = ?
        ORDER BY s.name ASC, c.name ASC
    `, [staffId, staffId, staffId, staffId, responsibilityDate, responsibilityDate, schoolId]);
};

// Resolve academic settings from the class's own section when it belongs to one.
// A configured section must never silently inherit another section's current term/session.
const getAcademicSettings = async (class_id = null, schoolId) => {
    if (class_id && schoolId) {
        const section = await db.get(`
            SELECT s.id, s.current_session, s.current_term
            FROM sections s
            JOIN classes c ON c.section_id = s.id
            WHERE c.id = ? AND c.school_id = ? AND s.school_id = ?
        `, [class_id, schoolId, schoolId]);

        if (section) {
            return {
                session: section.current_session || null,
                term: section.current_term || null,
                sectionConfigured: Boolean(section.current_session && section.current_term)
            };
        }
    }

    // Keep legacy/unsectioned classes working with the school's current settings.
    const session = schoolId ? await sessionHelper.getCurrentSession(schoolId) : null;
    const term = schoolId ? await sessionHelper.getCurrentTerm(schoolId) : null;
    return {
        session: session || null,
        term: term || null,
        sectionConfigured: Boolean(session && term)
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

        const attendanceGroups = [];
        for (const cls of classes) {
            const academicSettings = await getAcademicSettings(cls.id, schoolId);
            const hasAcademicContext = Boolean(academicSettings.session && academicSettings.term);
            let attendanceRecords = [];

            if (hasAcademicContext) {
                attendanceRecords = await db.all(`
                    SELECT a.student_id, a.status, a.date, s.first_name, s.last_name, s.parent_phone, a.reason
                    FROM attendance a
                    JOIN students s ON a.student_id = s.id
                    WHERE a.class_id = ? AND a.term = ? AND a.session = ?
                    ORDER BY a.student_id, a.date ASC
                `, [cls.id, academicSettings.term, academicSettings.session]);
            }

            const { summarizeAttendanceRecords } = require('../utils/attendanceStreakHelper');
            const studentStats = summarizeAttendanceRecords(attendanceRecords);

            // Determine flagged students based on total and current consecutive absences.
            const flagged = Object.values(studentStats).filter(student => {
                student.flag_reason = [];
                if (student.total_absent_days >= termAbsenceLimit) {
                    student.flag_reason.push(`Term Limit: ${student.total_absent_days} absences`);
                }
                if (student.current_consecutive_absent_days >= consecutiveAbsenceLimit) {
                    student.flag_reason.push(`Consecutive: ${student.current_consecutive_absent_days} days`);
                }
                return student.flag_reason.length > 0;
            });

            flagged.forEach(student => {
                const wa = buildWhatsAppAttendanceAction({
                    parent_phone: student.parent_phone,
                    total_absences: student.total_absent_days,
                    consecutive_absences: student.current_consecutive_absent_days,
                    term_limit: termAbsenceLimit,
                    consecutive_limit: consecutiveAbsenceLimit,
                    context: {
                        student_name: `${student.first_name} ${student.last_name}`,
                        class_name: cls.name,
                        term: academicSettings.term,
                        session: academicSettings.session,
                        school_name: schoolInfo.name,
                        school_phone: schoolInfo.phone
                    }
                });
                student.whatsapp_url = wa.whatsapp_url;
                student.whatsapp_phone = wa.display_phone;
                student.whatsapp_message = wa.message;
                student.has_valid_whatsapp = wa.is_valid;
            });

            // Only classes with actual flagged students belong in the alerts list.
            if (flagged.length > 0) {
                attendanceGroups.push({
                    class: cls,
                    section_name: cls.section_name || 'Unassigned section',
                    students: flagged,
                    hasAcademicContext,
                    session: academicSettings.session,
                    term: academicSettings.term
                });
            }
        }
        const attendanceSections = [...new Set(
            classes.map(cls => cls.section_name || 'Unassigned section')
        )].sort((a, b) => a.localeCompare(b));
        res.render('attendance/index', {
            title: 'Attendance Management',
            classes,
            user,
            attendanceGroups,
            attendanceSections,
            termAbsenceLimit,
            consecutiveAbsenceLimit
        });
    } catch (err) {
        console.error('Attendance Index Error:', err);
        res.status(500).send('Database Error');
    }
};

// Admin management for explicit, effective-dated register holders.
const getAttendanceResponsibilities = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user || user.role !== 'Admin') return res.status(403).send('Access denied');
    try {
        const [classes, staff, responsibilities] = await Promise.all([
            db.all('SELECT c.id, c.name, c.section_id, s.name AS section_name FROM classes c LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id WHERE c.school_id = ? ORDER BY s.name, c.name', [schoolId]),
            db.all("SELECT id, first_name, last_name FROM staff WHERE school_id = ? AND (status = 'active' OR status = 'Active' OR status IS NULL) ORDER BY last_name, first_name", [schoolId]),
            db.all(`SELECT r.*, c.name AS class_name, s.name AS section_name, st.first_name, st.last_name
                FROM class_attendance_responsibilities r
                JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
                LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
                JOIN staff st ON st.id = r.staff_id AND st.school_id = r.school_id
                WHERE r.school_id = ? ORDER BY r.effective_from DESC, r.id DESC`, [schoolId])
        ]);
        res.render('attendance/responsibilities', { title: 'Attendance Register Responsibilities', classes, staff, responsibilities, user, success: req.query.success === 'created' ? 'Register holder assigned successfully.' : req.query.success === 'ended' ? 'Register holder assignment ended successfully.' : null });
    } catch (err) {
        console.error('Attendance responsibilities load error:', err);
        res.status(500).send('Could not load attendance register responsibilities.');
    }
};

const createAttendanceResponsibility = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user || user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Admin access is required.' });
    try {
        const result = await require('../services/attendanceFoundationService').create('attendance_responsibility', {
            schoolId, classId: Number(req.body.class_id), staffId: Number(req.body.staff_id),
            session: req.body.session, effectiveFrom: req.body.effective_from,
            effectiveTo: req.body.effective_to || null, createdBy: Number(user.id)
        });
        logAction(user.id, 'CREATE_ATTENDANCE_RESPONSIBILITY', 'ATTENDANCE', {
            class_id: Number(req.body.class_id), staff_id: Number(req.body.staff_id),
            session: req.body.session, effective_from: req.body.effective_from,
            effective_to: req.body.effective_to || null
        }, req.ip);
        return res.redirect('/attendance/responsibilities?success=created');
    } catch (err) {
        console.error('Attendance responsibility create error:', err);
        return res.status(400).send(err.message || 'Could not assign register responsibility.');
    }
};

const endAttendanceResponsibility = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user || user.role !== 'Admin') return res.status(403).send('Access denied');
    try {
        await require('../services/attendanceFoundationService').correct(
            'attendance_responsibility', Number(req.params.id),
            { effective_to: req.body.effective_to },
            req.body.reason, Number(user.id), schoolId
        );
        logAction(user.id, 'END_ATTENDANCE_RESPONSIBILITY', 'ATTENDANCE', {
            responsibility_id: Number(req.params.id), effective_to: req.body.effective_to, reason: req.body.reason
        }, req.ip);
        return res.redirect('/attendance/responsibilities?success=ended');
    } catch (err) {
        return res.status(400).send(err.message || 'Could not end register responsibility.');
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
            const assignedClasses = await getAssignedClasses(user, schoolId, date);
            const hasAccess = assignedClasses.some(c => String(c.id) === String(class_id));
            if (!hasAccess) return res.redirect('/attendance?error=Access Denied');
        }

        const clazz = await db.get('SELECT * FROM classes WHERE id = ? AND school_id = ?', [Number(class_id), schoolId]);
        if (!clazz) return res.redirect('/attendance?error=Class not found');

        const settings = await getAcademicSettings(Number(class_id), schoolId);

        const students = await getAttendanceStudents(
            Number(class_id),
            settings.session,
            schoolId,
            date
        );

        const register = settings.session && settings.term ? await require('../services/attendanceRegisterService').getRegister({
            schoolId, classId: Number(class_id), sectionId: Number(clazz.section_id),
            date, session: settings.session, term: settings.term, actorId: Number(user.id)
        }) : null;

        res.render('attendance/take', {
            title: 'Mark Attendance',
            clazz,
            class_id,
            date,
            students,
            currentTerm: settings.term,
            currentSession: settings.session,
            registerStatus: register ? register.status : 'open',
            registerVersion: register ? register.submission_version : 0,
            registerEvents: register ? register.events : [],
            isAttendanceAdmin: user.role === 'Admin',
            readOnly: false,
            hasRecords: true
        });
    } catch (err) {
        console.error('getTakeAttendance Error:', err);
        res.status(500).send('Database Error');
    }
};

// GET /attendance/yesterday - View the previous calendar day's attendance
const getPreviousDayAttendance = async (req, res) => {
    const { class_id } = req.query;
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (!class_id || !Number.isInteger(Number(class_id)) || Number(class_id) <= 0) {
        return res.redirect('/attendance');
    }

    try {
        const clazz = await db.get(
            'SELECT * FROM classes WHERE id = ? AND school_id = ?',
            [Number(class_id), schoolId]
        );
        if (!clazz) return res.redirect('/attendance?error=Class not found');

        // Use the school's local calendar date, not the server's UTC date.
        const todayParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date()).reduce((parts, item) => {
            if (item.type !== 'literal') parts[item.type] = item.value;
            return parts;
        }, {});
        const today = new Date(Date.UTC(
            Number(todayParts.year),
            Number(todayParts.month) - 1,
            Number(todayParts.day)
        ));
        today.setUTCDate(today.getUTCDate() - 1);
        const date = [
            today.getUTCFullYear(),
            String(today.getUTCMonth() + 1).padStart(2, '0'),
            String(today.getUTCDate()).padStart(2, '0')
        ].join('-');

        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user, schoolId, date);
            if (!assignedClasses.some(c => String(c.id) === String(class_id))) {
                return res.redirect('/attendance?error=Access Denied');
            }
        }

        // Find records by class and calendar date first. This also handles
        // yesterday falling across an academic session/term boundary.
        const rows = await db.all(
            'SELECT student_id, status, session, term FROM attendance WHERE class_id = ? AND date = ?',
            [Number(class_id), date]
        );
        const hasRecords = rows.length > 0;
        const settings = hasRecords
            ? { session: rows[0].session, term: rows[0].term }
            : await getAcademicSettings(Number(class_id), schoolId);

        const students = await getAttendanceStudents(
            Number(class_id), settings.session, schoolId, date
        );
        const statusByStudent = new Map(rows.map(row => [String(row.student_id), row.status]));
        students.forEach(student => {
            student.status = statusByStudent.get(String(student.id)) || null;
        });
        const register = settings.session && settings.term ? await require('../services/attendanceRegisterService').getRegister({
            schoolId, classId: Number(class_id), sectionId: Number(clazz.section_id),
            date, session: settings.session, term: settings.term, actorId: Number(user.id)
        }) : null;

        res.render('attendance/take', {
            title: "Yesterday's Attendance",
            clazz,
            class_id,
            date,
            students,
            currentTerm: settings.term,
            currentSession: settings.session,
            registerStatus: register ? register.status : 'open',
            registerVersion: register ? register.submission_version : 0,
            registerEvents: register ? register.events : [],
            isAttendanceAdmin: user.role === 'Admin',
            readOnly: true,
            hasRecords
        });
    } catch (err) {
        console.error('getPreviousDayAttendance Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /attendance/save - Save an editable attendance draft.
const saveAttendance = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user) return res.status(401).json({ success: false, message: 'Session expired' });
    try {
        const classId = Number(req.body.class_id);
        const cls = await db.get('SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?', [classId, schoolId]);
        if (!cls || !cls.section_id) return res.status(403).json({ success: false, message: 'Class not found or section is not configured.' });
        if (user.role !== 'Admin') {
            const assigned = await getAssignedClasses(user, schoolId, req.body.date);
            if (!assigned.some(item => Number(item.id) === classId)) return res.status(403).json({ success: false, message: 'Access denied to this class.' });
        }
        const settings = await getAcademicSettings(classId, schoolId);
        const result = await require('../services/attendanceRegisterService').saveDraft({
            schoolId, classId, sectionId: Number(cls.section_id), date: req.body.date,
            session: req.body.session || settings.session, term: req.body.term || settings.term,
            actorId: Number(user.id), actorRole: user.role, attendance: req.body.attendance, reasons: req.body.reasons,
            custom_reasons: req.body.custom_reasons
        });
        logAction(user.id, 'SAVE_ATTENDANCE_DRAFT', 'ATTENDANCE', { class_id: classId, date: req.body.date, count: result.savedCount }, req.ip);
        return res.json({ success: true, message: 'Attendance draft saved successfully.', register: result });
    } catch (err) {
        const status = err.code === 'ATTENDANCE_REGISTER_FORBIDDEN' ? 403 : err.code === 'ATTENDANCE_REGISTER_CONFLICT' ? 409 : /required|valid|roster|status|belong|configured/i.test(err.message || '') ? 400 : 500;
        return res.status(status).json({ success: false, message: err.message || 'Database Error' });
    }
};

const submitAttendanceRegister = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user) return res.status(401).json({ success: false, message: 'Session expired' });
    try {
        const classId = Number(req.body.class_id);
        const cls = await db.get('SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?', [classId, schoolId]);
        if (!cls || !cls.section_id) return res.status(403).json({ success: false, message: 'Class not found or section is not configured.' });
        if (user.role !== 'Admin') {
            const assigned = await getAssignedClasses(user, schoolId, req.body.date);
            if (!assigned.some(item => Number(item.id) === classId)) return res.status(403).json({ success: false, message: 'Access denied to this class.' });
        }
        const settings = await getAcademicSettings(classId, schoolId);
        const result = await require('../services/attendanceRegisterService').submit({
            schoolId, classId, sectionId: Number(cls.section_id), date: req.body.date,
            session: req.body.session || settings.session, term: req.body.term || settings.term,
            actorId: Number(user.id), actorRole: user.role, attendance: req.body.attendance, reasons: req.body.reasons,
            custom_reasons: req.body.custom_reasons
        });
        logAction(user.id, 'SUBMIT_ATTENDANCE_REGISTER', 'ATTENDANCE', { class_id: classId, date: req.body.date, version: result.version }, req.ip);
        return res.json({ success: true, message: 'Attendance register submitted successfully.', register: result });
    } catch (err) {
        const status = err.code === 'ATTENDANCE_REGISTER_FORBIDDEN' ? 403 : err.code === 'ATTENDANCE_REGISTER_CONFLICT' ? 409 : /required|valid|roster|status|belong|configured|empty/i.test(err.message || '') ? 400 : 500;
        return res.status(status).json({ success: false, message: err.message || 'Database Error' });
    }
};

const reopenAttendanceRegister = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user) return res.status(401).json({ success: false, message: 'Session expired' });
    if (user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only an administrator can reopen a submitted register.' });
    try {
        const classId = Number(req.body.class_id);
        const cls = await db.get('SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?', [classId, schoolId]);
        if (!cls || !cls.section_id) return res.status(404).json({ success: false, message: 'Class not found.' });
        const settings = await getAcademicSettings(classId, schoolId);
        const result = await require('../services/attendanceRegisterService').reopen({
            schoolId, classId, sectionId: Number(cls.section_id), date: req.body.date,
            session: req.body.session || settings.session, term: req.body.term || settings.term,
            actorId: Number(user.id), actorRole: user.role, reason: req.body.reason
        });
        logAction(user.id, 'REOPEN_ATTENDANCE_REGISTER', 'ATTENDANCE', { class_id: classId, date: req.body.date, version: result.version, reason: req.body.reason }, req.ip);
        return res.json({ success: true, message: 'Register reopened for corrections.', register: result });
    } catch (err) {
        const status = err.code === 'ATTENDANCE_REGISTER_CONFLICT' ? 409 : /required|valid|belong|configured/i.test(err.message || '') ? 400 : 500;
        return res.status(status).json({ success: false, message: err.message || 'Database Error' });
    }
};
// GET /attendance/report - section-safe report powered by the shared analytics engine.
const getReport = async (req, res) => {
    const { class_id, start_date, end_date, threshold } = req.query;
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : (user ? user.school_id : 1));
    const isAdmin = user && user.role === 'Admin';
    let activeThreshold = 75;
    let classes = [];
    let reportData = null;
    let reportContext = null;
    let reportError = null;

    try {
        activeThreshold = await require('../services/attendanceThresholdService').getThreshold(schoolId, threshold);
        if (!Number.isFinite(activeThreshold) || activeThreshold < 0 || activeThreshold > 100) {
            throw new Error('Attendance threshold must be between 0 and 100.');
        }

        // A form master may report only on classes where they are the current form teacher.
        // Subject, general class, and register-responsibility assignments do not grant report access.
        classes = isAdmin
            ? await db.all(`SELECT c.id, c.name, c.section_id, s.name AS section_name
                FROM classes c
                LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
                WHERE c.school_id = ? ORDER BY s.name, c.name`, [schoolId])
            : await db.all(`SELECT c.id, c.name, c.section_id, s.name AS section_name
                FROM classes c
                LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
                WHERE c.school_id = ? AND c.form_teacher_id = ?
                ORDER BY s.name, c.name`, [schoolId, Number(user.id)]);

        if (class_id && start_date && end_date) {
            if (end_date < start_date) throw new Error('End date cannot be before start date.');
            const selectedClass = classes.find(item => String(item.id) === String(class_id));
            if (!selectedClass) {
                return res.status(403).send('Access denied: attendance reports are available only to administrators and the form master of the selected class.');
            }
            if (!selectedClass.section_id) {
                throw new Error('This class is not linked to a section, so section-safe attendance analytics cannot be calculated.');
            }

            const academic = await db.get(`SELECT current_session, current_term
                FROM sections WHERE id = ? AND school_id = ?`, [selectedClass.section_id, schoolId]);
            const session = academic && academic.current_session;
            const term = academic && academic.current_term;
            if (!session || !term) {
                throw new Error('Configure the selected section’s current session and term before generating this report.');
            }

            const students = await db.all(`SELECT DISTINCT st.id, st.first_name, st.last_name, st.admission_number
                FROM students st
                JOIN student_enrollment_periods ep
                  ON ep.student_id = st.id AND ep.school_id = st.school_id
                WHERE st.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
                  AND ep.session = ? AND ep.start_date <= ?
                  AND (ep.end_date IS NULL OR ep.end_date >= ?)
                ORDER BY st.last_name, st.first_name`,
            [schoolId, selectedClass.section_id, selectedClass.id, session, end_date, start_date]);

            const analytics = require('../services/attendanceAnalyticsService');
            reportData = [];
            for (const student of students) {
                const result = await analytics.calculate({
                    schoolId, sectionId: Number(selectedClass.section_id),
                    classId: Number(selectedClass.id), studentId: Number(student.id),
                    session, term, startDate: start_date, endDate: end_date,
                    lowAttendanceThreshold: activeThreshold
                });
                reportData.push({
                    ...student,
                    expected: result.counts.expected,
                    recorded: result.counts.recorded,
                    present: result.counts.present,
                    late: result.counts.late,
                    absent: result.counts.absent,
                    leave: result.counts.approvedLeave,
                    missing_register: result.counts.missingRegister,
                    draft_register: result.counts.draftRegister,
                    missing_student_record: result.counts.missingStudentRecord,
                    unknown_days: result.counts.unknownSchedule + result.counts.unknownEnrollment + result.counts.unknownPeriod,
                    attendance_rate: result.attendanceRate,
                    low_attendance: result.lowAttendance
                });
            }
            reportContext = { session, term, section_name: selectedClass.section_name,
                class_name: selectedClass.name, threshold: activeThreshold };
        }

        return res.render('attendance/report', {
            title: 'Attendance Report', classes, user, reportData, reportContext,
            reportError, filters: { class_id, start_date, end_date, threshold: activeThreshold }
        });
    } catch (err) {
        console.error('Attendance Report Error:', err);
        reportError = err.message || 'Unable to generate attendance report.';
        return res.status(400).render('attendance/report', {
            title: 'Attendance Report', classes, user, reportData: null, reportContext,
            reportError, filters: { class_id, start_date, end_date, threshold: activeThreshold }
        });
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

module.exports = { getIndex, getTakeAttendance, getPreviousDayAttendance, saveAttendance, submitAttendanceRegister, reopenAttendanceRegister, getAttendanceResponsibilities, createAttendanceResponsibility, endAttendanceResponsibility, getReport, getStaffAttendance, saveStaffAttendance };

