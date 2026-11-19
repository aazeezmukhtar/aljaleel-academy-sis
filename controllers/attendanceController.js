const db = require('../utils/db');
const { logAction } = require('../utils/logger');
const { getAttendanceStudents } = require('../utils/attendanceStudentHelper');
const sessionHelper = require('../utils/sessionHelper');
const { buildWhatsAppAttendanceAction } = require('../utils/whatsappHelper');
const attendanceRegisterGeneration = require('../services/attendanceRegisterGenerationService');
const attendanceRegisterWorkflow = require('../services/attendanceRegisterWorkflowService');
const attendanceRegisterAdministration = require('../services/attendanceRegisterAdministrationService');
const attendanceClosureService = require('../services/attendanceClosureService');

// Helper: get classes assigned to a staff member
const getAssignedClasses = async (user, schoolId) => {
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
    return await db.all(`
        SELECT DISTINCT c.*, s.name AS section_name
        FROM classes c
        LEFT JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
        LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
        LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
        WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
          AND c.school_id = ?
        ORDER BY s.name ASC, c.name ASC
    `, [staffId, staffId, staffId, schoolId]);
};

// Only an administrator or the responsible teacher snapshotted on the register
// may record, correct or submit register attendance.
const hasRegisterAttendanceAuthority = async (user, register, schoolId) => {
    if (user && user.role === 'Admin') return true;
    if (!user || !register || !register.responsibility_id) return false;
    const responsible = await db.get(`
        SELECT r.staff_id
        FROM class_attendance_responsibilities r
        JOIN staff s ON s.id = r.staff_id AND s.school_id = r.school_id
        WHERE r.id = ? AND r.school_id = ?
    `, [register.responsibility_id, schoolId]);
    return !!responsible && String(responsible.staff_id) === String(user.id);
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
        let register = null;
        let registerFeatureAvailable = false;
        let registerSkipReason = null;
        let students = null;

        // The application remains compatible with databases where the additive
        // attendance-register migration has not yet been applied.
        try {
            registerFeatureAvailable = await attendanceRegisterWorkflow.isFoundationAvailable();
            if (registerFeatureAvailable) {
                let context = await attendanceRegisterWorkflow.getRegisterContext({
                    schoolId, classId: Number(class_id), registerDate: date
                });
                if (context) {
                    register = context.register;
                    students = context.students;
                    registerSkipReason = context.blockedReason;
                } else {
                    const generated = await attendanceRegisterGeneration.generateExpectedRegister({
                        schoolId,
                        classId: Number(class_id),
                        registerDate: date,
                        generatedBy: user.id
                    });
                    if (generated.skipped) registerSkipReason = generated.reason;
                    context = await attendanceRegisterWorkflow.getRegisterContext({
                        schoolId, classId: Number(class_id), registerDate: date
                    });
                    if (context) {
                        register = context.register;
                        students = context.students;
                        registerSkipReason = context.blockedReason;
                    }
                }
            }
        } catch (registerError) {
            // Fail closed to the established attendance sheet. Do not prevent
            // ordinary attendance entry if register setup is incomplete.
            console.error('Attendance register preparation unavailable:', registerError);
            registerSkipReason = 'register_preparation_unavailable';
        }

        if (!students) {
            students = await getAttendanceStudents(
                Number(class_id),
                settings.session,
                schoolId,
                date
            );
        }

        const registerBlocked = ['approved_closure', 'not_a_scheduled_day', 'register_preparation_unavailable'].includes(registerSkipReason);
        const locked = !!register && ['submitted', 'closed'].includes(register.status);
        const canManageRegister = register
            ? await hasRegisterAttendanceAuthority(user, register, schoolId)
            : true;
        const readOnly = registerBlocked || (!!register && (locked || !canManageRegister));
        res.render('attendance/take', {
            title: 'Mark Attendance',
            clazz,
            class_id,
            date,
            students,
            currentTerm: register ? register.term : settings.term,
            currentSession: register ? register.session : settings.session,
            register,
            registerFeatureAvailable,
            registerSkipReason,
            readOnly,
            canEdit: !registerBlocked && !locked && canManageRegister,
            isAdmin: user.role === 'Admin',
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
        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user, schoolId);
            if (!assignedClasses.some(c => String(c.id) === String(class_id))) {
                return res.redirect('/attendance?error=Access Denied');
            }
        }

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

        let register = null;
        let registerFeatureAvailable = false;
        let registerSkipReason = null;
        let registerContext = null;
        try {
            registerFeatureAvailable = await attendanceRegisterWorkflow.isFoundationAvailable();
            if (registerFeatureAvailable) {
                registerContext = await attendanceRegisterWorkflow.getRegisterContext({
                    schoolId, classId: Number(class_id), registerDate: date
                });
            }
        } catch (registerError) {
            console.error('Previous-day attendance register lookup unavailable:', registerError);
            registerSkipReason = 'register_lookup_unavailable';
        }

        let students = registerContext
            ? registerContext.students
            : await getAttendanceStudents(Number(class_id), settings.session, schoolId, date);
        if (registerContext) {
            register = registerContext.register;
        } else {
            const statusByStudent = new Map(rows.map(row => [String(row.student_id), row.status]));
            students.forEach(student => {
                student.status = statusByStudent.get(String(student.id)) || null;
            });
        }

        const locked = !!register && ['submitted', 'closed'].includes(register.status);
        res.render('attendance/take', {
            title: "Yesterday's Attendance",
            clazz,
            class_id,
            date,
            students,
            currentTerm: register ? register.term : settings.term,
            currentSession: register ? register.session : settings.session,
            register,
            registerFeatureAvailable,
            registerSkipReason,
            readOnly: true,
            canEdit: !locked && !(registerContext && registerContext.blockedReason) && (register ? await hasRegisterAttendanceAuthority(user, register, schoolId) : true),
            isAdmin: user.role === 'Admin',
            hasRecords
        });
    } catch (err) {
        console.error('getPreviousDayAttendance Error:', err);
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
        const classCheck = await db.get(
            'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
            [Number(class_id), schoolId]
        );
        if (!classCheck) return res.status(403).json({ success: false, message: 'Class not found or access denied' });
        if (!classCheck.section_id) {
            return res.status(409).json({
                success: false,
                message: 'This class has no section assigned. Attendance cannot be saved until its section is configured.'
            });
        }

        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user, schoolId);
            const hasAccess = assignedClasses.some(c => String(c.id) === String(class_id));
            if (!hasAccess) return res.status(403).json({ success: false, message: 'Access Denied to this class' });
        }

        const registerFoundationAvailable = await attendanceRegisterWorkflow.isFoundationAvailable();
        if (registerFoundationAvailable) {
            let registerContext = await attendanceRegisterWorkflow.getRegisterContext({
                schoolId, classId: Number(class_id), registerDate: date
            });
            if (registerContext && registerContext.blockedReason === 'approved_closure') {
                return res.status(409).json({
                    success: false,
                    message: 'Attendance cannot be recorded because an approved closure covers this date.'
                });
            }
            if (!registerContext) {
                const generated = await attendanceRegisterGeneration.generateExpectedRegister({
                    schoolId,
                    classId: Number(class_id),
                    registerDate: date,
                    generatedBy: user.id
                });
                if (generated.skipped && ['approved_closure', 'not_a_scheduled_day'].includes(generated.reason)) {
                    return res.status(409).json({
                        success: false,
                        message: generated.reason === 'approved_closure'
                            ? 'Attendance cannot be recorded because an approved closure covers this date.'
                            : 'Attendance cannot be recorded because this class is not scheduled to open on this date.'
                    });
                }
                registerContext = await attendanceRegisterWorkflow.getRegisterContext({
                    schoolId, classId: Number(class_id), registerDate: date
                });
            }
            if (registerContext) {
                if (!(await hasRegisterAttendanceAuthority(user, registerContext.register, schoolId))) {
                    return res.status(403).json({
                        success: false,
                        message: 'Only an administrator or the responsible class teacher may record this register.'
                    });
                }
                const saved = await attendanceRegisterWorkflow.saveRegisterProgress({
                    schoolId,
                    classId: Number(class_id),
                    registerDate: date,
                    actorStaffId: user.id,
                    isAdministrator: user.role === 'Admin',
                    attendance: attendance || {},
                    reasons: reasons || {},
                    customReasons: custom_reasons || {}
                });
                logAction(user.id, 'SAVE_ATTENDANCE_PROGRESS', 'ATTENDANCE_REGISTER', {
                    class_id, date, changed_count: saved.changedStudentCount,
                    saved_student_count: saved.savedStudentCount
                }, req.ip);
                return res.json({
                    success: true,
                    message: 'Attendance progress saved. Submit the register when every student has a deliberate status.',
                    register: saved
                });
            }
        }

        const sql = `
            INSERT INTO attendance
                (student_id, class_id, section_id, date, status, session, term, reason, reason_type, custom_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, section_id, date, session, term)
            DO UPDATE SET
                status = excluded.status,
                class_id = excluded.class_id,
                reason = excluded.reason,
                reason_type = excluded.reason_type,
                custom_reason = excluded.custom_reason
        `;

        const settings = await getAcademicSettings(class_id, schoolId);
        const effectiveSession = session || settings.session;
        const effectiveTerm = term || settings.term;
        if (!effectiveSession || !effectiveTerm) {
            return res.status(409).json({
                success: false,
                message: 'The selected class has no configured academic session and term.'
            });
        }

        await db.transaction(async (client) => {
            for (const [studentIdStr, status] of Object.entries(attendance || {})) {
                const student_id = Number(studentIdStr);
                if (!Number.isSafeInteger(student_id) || student_id <= 0) continue;
                if (status !== 'Not recorded' && !['Present', 'Absent', 'Late', 'Leave'].includes(status)) {
                    throw new Error('Unsupported attendance status for student ' + student_id + '.');
                }

                // Validate tenant ownership and membership in the selected class/session.
                // Preserve the legacy current_class_id fallback only when the student has
                // no enrollment row at all for this session, matching the attendance sheet.
                const studentCheck = await db.get(`
                    SELECT s.id
                    FROM students s
                    WHERE s.id = ? AND s.school_id = ?
                      AND (
                        EXISTS (
                            SELECT 1 FROM student_enrollments se
                            WHERE se.student_id = s.id
                              AND se.class_id = ?
                              AND se.session = ?
                        )
                        OR (
                            s.current_class_id = ?
                            AND NOT EXISTS (
                                SELECT 1 FROM student_enrollments se_current
                                WHERE se_current.student_id = s.id
                                  AND se_current.session = ?
                            )
                        )
                      )
                `, [student_id, schoolId, Number(class_id), effectiveSession,
                    Number(class_id), effectiveSession], client);
                if (!studentCheck) continue;

                const existing = await db.get(`
                    SELECT id, class_id, status, reason, reason_type, custom_reason
                    FROM attendance
                    WHERE student_id = ? AND section_id = ? AND date = ? AND session = ? AND term = ?
                `, [student_id, Number(classCheck.section_id), date, effectiveSession, effectiveTerm], client);

                if (existing && Number(existing.class_id) !== Number(class_id)) {
                    throw new Error('An attendance record for this student already belongs to another class in this section and period.');
                }

                if (status === 'Not recorded') {
                    if (existing) {
                        await db.run('DELETE FROM attendance WHERE id = ?', [existing.id], client);
                        if (registerFoundationAvailable) {
                            await db.run(`
                                INSERT INTO attendance_foundation_audit_logs
                                    (entity_type, entity_id, action, actor_staff_id, before_data, after_data, reason)
                                VALUES ('attendance', ?, 'attendance_status_cleared', ?, ?, NULL,
                                        'Attendance status cleared to unmarked.')
                            `, [existing.id, user.id, JSON.stringify({
                                status: existing.status,
                                reason: existing.reason,
                                reason_type: existing.reason_type,
                                custom_reason: existing.custom_reason
                            })], client);
                        }
                    }
                    continue;
                }

                const rawReason = reasons[studentIdStr] || null;
                const customReason = custom_reasons[studentIdStr] || null;

                let reason = rawReason;
                if (rawReason === 'Other' && customReason) {
                    reason = customReason;
                }

                await db.run(sql, [
                    student_id,
                    Number(class_id),
                    Number(classCheck.section_id),
                    date,
                    status,
                    effectiveSession,
                    effectiveTerm,
                    reason,
                    rawReason,
                    customReason
                ], client);

                const changed = !existing || existing.status !== status ||
                    existing.reason !== reason || existing.reason_type !== rawReason ||
                    existing.custom_reason !== customReason;
                if (registerFoundationAvailable && changed) {
                    const stored = await db.get(`
                        SELECT id FROM attendance
                        WHERE student_id = ? AND class_id = ? AND section_id = ?
                          AND date = ? AND session = ? AND term = ?
                    `, [student_id, Number(class_id), Number(classCheck.section_id),
                        date, effectiveSession, effectiveTerm], client);
                    await db.run(`
                        INSERT INTO attendance_foundation_audit_logs
                            (entity_type, entity_id, action, actor_staff_id, before_data, after_data, reason)
                        VALUES ('attendance', ?, ?, ?, ?, ?, ?)
                    `, [
                        stored.id,
                        existing ? 'attendance_status_updated' : 'attendance_status_created',
                        user.id,
                        existing ? JSON.stringify({
                            status: existing.status,
                            reason: existing.reason,
                            reason_type: existing.reason_type,
                            custom_reason: existing.custom_reason
                        }) : null,
                        JSON.stringify({
                            status, reason, reason_type: rawReason, custom_reason: customReason
                        }),
                        existing ? 'Attendance status or reason corrected.' : 'Attendance status recorded.'
                    ], client);
                }
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

// POST /attendance/submit - Validate and submit a server-backed attendance register
const submitAttendanceRegister = async (req, res) => {
    const { class_id, date } = req.body || {};
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Session expired' });
    }
    if (!class_id || !Number.isSafeInteger(Number(class_id)) || Number(class_id) <= 0 || !date) {
        return res.status(400).json({ success: false, message: 'A valid class and attendance date are required.' });
    }

    try {
        const clazz = await db.get(
            'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
            [Number(class_id), schoolId]
        );
        if (!clazz || !clazz.section_id) {
            return res.status(403).json({ success: false, message: 'Class not found or access denied.' });
        }

        if (user.role !== 'Admin') {
            const assignedClasses = await getAssignedClasses(user, schoolId);
            if (!assignedClasses.some(item => String(item.id) === String(class_id))) {
                return res.status(403).json({ success: false, message: 'Access denied to this class.' });
            }
        }

        if (!(await attendanceRegisterWorkflow.isFoundationAvailable())) {
            return res.status(409).json({
                success: false,
                message: 'The attendance register foundation is not installed. The register cannot be submitted yet.'
            });
        }

        let registerContext = await attendanceRegisterWorkflow.getRegisterContext({
            schoolId, classId: Number(class_id), registerDate: date
        });
        if (registerContext && registerContext.blockedReason === 'approved_closure') {
            return res.status(409).json({
                success: false,
                message: 'This date is covered by an approved closure; the register cannot be submitted.'
            });
        }
        if (!registerContext) {
            const generated = await attendanceRegisterGeneration.generateExpectedRegister({
                schoolId,
                classId: Number(class_id),
                registerDate: date,
                generatedBy: user.id
            });
            if (generated.skipped && ['approved_closure', 'not_a_scheduled_day'].includes(generated.reason)) {
                return res.status(409).json({
                    success: false,
                    message: generated.reason === 'approved_closure'
                        ? 'This date is covered by an approved closure; the register cannot be submitted.'
                        : 'This class is not scheduled to open on this date; the register cannot be submitted.'
                });
            }
            registerContext = await attendanceRegisterWorkflow.getRegisterContext({
                schoolId, classId: Number(class_id), registerDate: date
            });
        }
        if (registerContext && !(await hasRegisterAttendanceAuthority(user, registerContext.register, schoolId))) {
            return res.status(403).json({
                success: false,
                message: 'Only an administrator or the responsible class teacher may submit this register.'
            });
        }

        const submitted = await attendanceRegisterWorkflow.submitRegister({
            schoolId,
            classId: Number(class_id),
            registerDate: date,
            actorStaffId: user.id,
            isAdministrator: user.role === 'Admin'
        });
        logAction(user.id, 'SUBMIT_ATTENDANCE_REGISTER', 'ATTENDANCE_REGISTER', {
            class_id, date, submitted_student_count: submitted.submittedStudentCount
        }, req.ip);

        return res.json({
            success: true,
            message: 'Attendance register submitted successfully.',
            register: submitted
        });
    } catch (err) {
        console.error('submitAttendanceRegister Error:', err);
        return res.status(409).json({
            success: false,
            message: err.message || 'The attendance register could not be submitted.'
        });
    }
};

// POST /attendance/reopen - Reopen a submitted register for administrator-approved correction
const reopenAttendanceRegister = async (req, res) => {
    const { class_id, date, reason } = req.body || {};
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Session expired' });
    }
    if (user.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Only an administrator may reopen a submitted register.' });
    }
    if (!class_id || !Number.isSafeInteger(Number(class_id)) || Number(class_id) <= 0 || !date) {
        return res.status(400).json({ success: false, message: 'A valid class and attendance date are required.' });
    }

    try {
        if (!(await attendanceRegisterWorkflow.isFoundationAvailable())) {
            return res.status(409).json({ success: false, message: 'The attendance register foundation is not installed.' });
        }
        const reopened = await attendanceRegisterAdministration.reopenRegister({
            schoolId,
            classId: Number(class_id),
            registerDate: date,
            actorStaffId: user.id,
            reason
        });
        logAction(user.id, 'REOPEN_ATTENDANCE_REGISTER', 'ATTENDANCE_REGISTER', {
            class_id, date, register_id: reopened.registerId, reason: reopened.reason
        }, req.ip);
        return res.json({
            success: true,
            message: 'Attendance register reopened. The correction is recorded in the audit history.',
            register: reopened
        });
    } catch (err) {
        console.error('reopenAttendanceRegister Error:', err);
        return res.status(409).json({
            success: false,
            message: err.message || 'The attendance register could not be reopened.'
        });
    }
};

// GET /attendance/closures - Request and administer attendance closures
const getAttendanceClosures = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        if (!(await attendanceRegisterWorkflow.isFoundationAvailable())) {
            return res.status(409).render('attendance/closures', {
                title: 'Attendance Closures', user, isAdmin: user.role === 'Admin',
                classes: [], sections: [], closures: [],
                error: 'The attendance register foundation is not installed yet.'
            });
        }
        const classes = await getAssignedClasses(user, schoolId);
        const sections = user.role === 'Admin'
            ? await db.all('SELECT id, name FROM sections WHERE school_id = ? ORDER BY name', [schoolId])
            : [];
        const closures = await attendanceClosureService.listClosures({ schoolId, actorStaffId: user.id });
        return res.render('attendance/closures', {
            title: 'Attendance Closures', user, isAdmin: user.role === 'Admin',
            classes, sections, closures, error: null
        });
    } catch (err) {
        console.error('getAttendanceClosures Error:', err);
        return res.status(500).send('Could not load attendance closures.');
    }
};

// POST /attendance/closures/request
const requestAttendanceClosure = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user) return res.status(401).json({ success: false, message: 'Session expired' });
    try {
        if (!(await attendanceRegisterWorkflow.isFoundationAvailable())) {
            return res.status(409).json({ success: false, message: 'The attendance register foundation is not installed.' });
        }
        const result = await attendanceClosureService.requestClosure({
            schoolId, actorStaffId: user.id,
            scopeType: req.body.scope_type,
            sectionId: req.body.section_id,
            classId: req.body.class_id,
            startDate: req.body.start_date,
            endDate: req.body.end_date,
            reason: req.body.reason
        });
        logAction(user.id, 'REQUEST_ATTENDANCE_CLOSURE', 'ATTENDANCE_CLOSURE', {
            closure_id: result.closureId, scope_type: result.scope_type,
            start_date: result.startDate, end_date: result.endDate
        }, req.ip);
        return res.json({ success: true, message: 'Closure request submitted for administrator review.', closure: result });
    } catch (err) {
        return res.status(409).json({ success: false, message: err.message || 'Closure request failed.' });
    }
};

// POST /attendance/closures/decide
const decideAttendanceClosure = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user) return res.status(401).json({ success: false, message: 'Session expired' });
    if (user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only an administrator may decide closure requests.' });
    try {
        const result = await attendanceClosureService.decideClosure({
            schoolId, closureId: req.body.closure_id, actorStaffId: user.id,
            decision: req.body.decision, reason: req.body.reason
        });
        logAction(user.id, 'DECIDE_ATTENDANCE_CLOSURE', 'ATTENDANCE_CLOSURE', {
            closure_id: result.closureId, decision: result.status
        }, req.ip);
        return res.json({ success: true, message: 'Closure request ' + result.status + '.', closure: result });
    } catch (err) {
        return res.status(409).json({ success: false, message: err.message || 'Closure decision failed.' });
    }
};

// POST /attendance/closures/cancel
const cancelAttendanceClosure = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!user) return res.status(401).json({ success: false, message: 'Session expired' });
    try {
        const result = await attendanceClosureService.cancelClosure({
            schoolId, closureId: req.body.closure_id, actorStaffId: user.id
        });
        logAction(user.id, 'CANCEL_ATTENDANCE_CLOSURE', 'ATTENDANCE_CLOSURE', {
            closure_id: result.closureId
        }, req.ip);
        return res.json({ success: true, message: 'Closure request cancelled.', closure: result });
    } catch (err) {
        return res.status(409).json({ success: false, message: err.message || 'Closure cancellation failed.' });
    }
};

// GET /attendance/report - Attendance summary report
const getReport = async (req, res) => {
    const { class_id, start_date, end_date } = req.query;
    const user = req.session.staff;

    try {
        const schoolId = req.schoolId || (req.school ? req.school.id : (user ? user.school_id : 1));
        const classes = await getAssignedClasses(user, schoolId);
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
                    JOIN classes c ON c.id = a.class_id AND c.school_id = s.school_id
                    WHERE a.class_id = ? AND a.date BETWEEN ? AND ? AND s.school_id = ?
                    GROUP BY s.id
                    ORDER BY s.last_name, s.first_name
                `, [Number(class_id), start_date, end_date, schoolId]);
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

module.exports = { getIndex, getTakeAttendance, getPreviousDayAttendance, saveAttendance, submitAttendanceRegister, reopenAttendanceRegister, getAttendanceClosures, requestAttendanceClosure, decideAttendanceClosure, cancelAttendanceClosure, getReport, getStaffAttendance, saveStaffAttendance };

