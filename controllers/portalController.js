const db = require('../utils/db');
const bcrypt = require('bcryptjs');

const getSettings = async () => {
    const rows = await db.all('SELECT key, value FROM settings');
    const settings = {};
    if (rows) {
        rows.forEach(r => settings[r.key] = r.value);
    }
    return settings;
};

exports.getDashboard = async (req, res) => {
    const studentId = req.session.student.id;
    const school = await getSettings();

    // Fetch latest results (added AVG total for Phase 2)
    const results = await db.all(`
        SELECT session, term, COUNT(*) as subjects_taken, AVG(total) as average_score
        FROM results
        WHERE student_id = ? AND status IN ('approved', 'published')
        GROUP BY session, term
        ORDER BY session DESC, term DESC
    `, [studentId]);

    // Fetch fee payments
    const payments = await db.all(`
        SELECT p.*, fc.session, fc.term 
        FROM payments p
        JOIN student_fees sf ON p.student_fee_id = sf.id
        JOIN fee_categories fc ON sf.fee_category_id = fc.id
        WHERE p.student_id = ?
        ORDER BY p.payment_date DESC
        LIMIT 5
    `, [studentId]);

    const currentSessionStr = school.current_session || '2024/2025';
    
    // Get student's enrolled sections
    const enrollments = await db.all(`
        SELECT s.id as section_id 
        FROM student_enrollments se 
        JOIN classes c ON se.class_id = c.id 
        JOIN sections s ON c.section_id = s.id 
        WHERE se.student_id = ? AND se.session = s.current_session
    `, [studentId]);
    const sectionIds = (enrollments || []).map(e => e.section_id);
    
    let sectionFilter = '';
    if (sectionIds.length > 0) {
        sectionFilter = ` AND (section_id IS NULL OR section_id IN (${sectionIds.join(',')}))`;
    } else {
        sectionFilter = ` AND section_id IS NULL`;
    }

    // Fetch latest announcements
    const announcements = await db.all(`
        SELECT * FROM announcements 
        WHERE is_published = 1 AND (target_role = 'Students' OR target_role = 'All')
        ${sectionFilter}
        ORDER BY created_at DESC LIMIT 3
    `);

    // Fetch latest class posts (general + targeted) for all classes the student is enrolled in
    const enrollRows = await db.all(`
        SELECT class_id FROM student_enrollments WHERE student_id = ?
    `, [studentId]);
    
    let enrolledClassIds = (enrollRows || []).map(r => r.class_id);
    if (enrolledClassIds.length === 0 && req.session.student.current_class_id) {
        enrolledClassIds = [req.session.student.current_class_id];
    }

    let classPosts = [];
    if (enrolledClassIds.length > 0) {
        const placeholders = enrolledClassIds.map(() => '?').join(',');
        classPosts = await db.all(`
            SELECT cp.*, s.first_name, s.last_name 
            FROM class_posts cp 
            JOIN staff s ON cp.teacher_id = s.id 
            WHERE cp.class_id IN (${placeholders}) AND (cp.student_id IS NULL OR cp.student_id = ?) 
            ORDER BY cp.created_at DESC LIMIT 5
        `, [...enrolledClassIds, studentId]);
    }

    const msgCountObj = await db.get('SELECT COUNT(*) as c FROM class_posts WHERE student_id = ?', [studentId]);
    const individualMessagesCount = msgCountObj ? msgCountObj.c : 0;
    
    // Fee Stats for Progress Bar
    const feeStats = await db.get(`
        SELECT 
            SUM(total_amount) as expected,
            SUM(paid_amount) as collected
        FROM student_fees
        WHERE student_id = ?
    `, [studentId]);
    const expectedFees = (feeStats && feeStats.expected) || 0;
    const collectedFees = (feeStats && feeStats.collected) || 0;
    const feeProgress = expectedFees > 0 ? Math.round((collectedFees / expectedFees) * 100) : 0;
    const feeBalance = expectedFees - collectedFees;
    
    // Fetch upcoming events
    const eventsSql = db.DB_TYPE === 'postgres'
        ? `SELECT * FROM term_events WHERE event_date >= CURRENT_DATE ${sectionFilter} ORDER BY event_date ASC LIMIT 5`
        : `SELECT * FROM term_events WHERE event_date >= date('now') ${sectionFilter} ORDER BY event_date ASC LIMIT 5`;

    const upcomingEvents = await db.all(eventsSql);

    // Fetch student data with enrolled classes
    const studentObj = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    const enrolledClasses = await db.all(`
        SELECT c.name as class_name, sec.name as section_name, 
               sec.current_session as section_session, sec.current_term as section_term
        FROM student_enrollments se 
        JOIN classes c ON se.class_id = c.id 
        LEFT JOIN sections sec ON c.section_id = sec.id
        WHERE se.student_id = ? AND se.session = sec.current_session
    `, [studentId]);
    
    if (studentObj) {
        if (enrolledClasses && enrolledClasses.length > 0) {
            studentObj.class_name = enrolledClasses.map(c => c.class_name).join(', ');
        } else {
            const classRow = studentObj.current_class_id ? await db.get('SELECT name FROM classes WHERE id = ?', [studentObj.current_class_id]) : null;
            studentObj.class_name = classRow ? classRow.name : 'Unassigned';
        }
    }

    const sectionInfo = (enrolledClasses || []).map(ec => ({
        class_name: ec.class_name,
        section_name: ec.section_name,
        current_session: ec.section_session || school.current_session || currentSessionStr,
        current_term: ec.section_term || school.current_term || '1st Term'
    }));

    // Calculate attendance percentage for current term and session
    const activeSession = sectionInfo.length > 0 ? sectionInfo[0].current_session : currentSessionStr;
    const activeTerm = sectionInfo.length > 0 ? sectionInfo[0].current_term : (school.current_term || '1st Term');

    const attRows = await db.all(`
        SELECT status 
        FROM attendance 
        WHERE student_id = ? AND session = ? AND term = ?
    `, [studentId, activeSession, activeTerm]);

    let attendancePercentage = null;
    if (attRows && attRows.length > 0) {
        const presentCount = attRows.filter(r => r.status === 'Present' || r.status === 'Late').length;
        attendancePercentage = Math.round((presentCount / attRows.length) * 100);
    }

    res.render('portal/index', {
        title: 'Student Dashboard',
        path: '/portal',
        school,
        results: results || [],
        payments: payments || [],
        announcements: announcements || [],
        classPosts: classPosts || [],
        upcomingEvents: upcomingEvents || [],
        student: studentObj || req.session.student,
        individualMessagesCount,
        feeProgress,
        feeBalance,
        sectionInfo,
        attendancePercentage,
        currentTerm: activeTerm,
        currentSession: activeSession,
        error: req.query.error
    });
};

exports.getResults = (req, res) => {
    res.redirect('/portal');
};

exports.viewTermlyResult = async (req, res) => {
    const term = req.query.term;
    const session = req.query.session;
    const approved = (await db.get(`SELECT COUNT(*) as c FROM results WHERE student_id = ? AND term = ? AND session = ? AND status IN ('approved', 'published')`, [req.session.student.id, term, session])).c;
    if (approved === 0) {
        return res.redirect('/portal?error=Results not yet published by the Administrator.');
    }
    req.params.student_id = req.session.student.id;
    const resultController = require('./resultController');
    await resultController.getReportCard(req, res);
};

exports.viewCumulativeResult = async (req, res) => {
    const session = req.query.session;
    const approved = (await db.get(`SELECT COUNT(*) as c FROM results WHERE student_id = ? AND session = ? AND status IN ('approved', 'published')`, [req.session.student.id, session])).c;
    if (approved === 0) {
        return res.redirect('/portal?error=Results not yet published by the Administrator.');
    }
    req.params.student_id = req.session.student.id;
    const resultController = require('./resultController');
    await resultController.getCumulativeReport(req, res);
};

exports.getProfile = async (req, res) => {
    const studentId = req.session.student.id;
    try {
        const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
        if (!student) return res.redirect('/portal?error=Student not found');
        
        let formattedDob = '';
        if (student.dob) {
            const d = new Date(student.dob);
            if (!isNaN(d.getTime())) {
                formattedDob = d.toISOString().slice(0, 10);
            }
        }
        student.formatted_dob = formattedDob;

        res.render('portal/profile', {
            title: 'My Profile & Settings',
            student,
            school: await getSettings(),
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error('Portal Get Profile Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.postUpdateProfile = async (req, res) => {
    const studentId = req.session.student.id;
    const { dob, phone, email, address } = req.body;
    let passport_photo_path = null;
    if (req.file) {
        passport_photo_path = `/uploads/${req.file.filename}`;
    }

    try {
        if (passport_photo_path) {
            await db.run(
                'UPDATE students SET dob = ?, phone = ?, email = ?, address = ?, passport_photo_path = ? WHERE id = ?',
                [dob || null, phone || null, email || null, address || null, passport_photo_path, studentId]
            );
            req.session.student.passport_photo_path = passport_photo_path;
        } else {
            await db.run(
                'UPDATE students SET dob = ?, phone = ?, email = ?, address = ? WHERE id = ?',
                [dob || null, phone || null, email || null, address || null, studentId]
            );
        }

        res.redirect('/portal/profile?success=Profile updated successfully');
    } catch (err) {
        console.error('Portal Update Profile Error:', err);
        res.redirect('/portal/profile?error=Failed to update profile');
    }
};

exports.getChangePassword = (req, res) => {
    res.render('portal/change_password', {
        title: 'Change Password - Scholar Portal',
        studentUser: req.session.student,
        error: req.query.error,
        success: req.query.success
    });
};

exports.postChangePassword = async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const studentId = req.session.student.id;

    if (new_password !== confirm_password) {
        return res.redirect('/portal/change-password?error=New passwords do not match');
    }

    try {
        const student = await db.get('SELECT password, admission_number FROM students WHERE id = ?', [studentId]);

        let isMatch = false;
        if (student.password && (student.password.startsWith('$2a$') || student.password.startsWith('$2b$') || student.password.startsWith('$2y$'))) {
            isMatch = await bcrypt.compare(current_password, student.password);
        } else if (student.password) {
            isMatch = (student.password === current_password);
        } else {
            isMatch = (current_password === student.admission_number);
        }

        if (!isMatch) {
            return res.redirect('/portal/change-password?error=Incorrect current password');
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await db.run('UPDATE students SET password = ? WHERE id = ?', [hashedPassword, studentId]);
        
        res.redirect('/portal/change-password?success=Password updated successfully');
    } catch (err) {
        console.error('Portal Change Password Error:', err);
        res.redirect('/portal/change-password?error=Database error occurred');
    }
};

exports.getCalendar = async (req, res) => {
    try {
        const events = await db.all('SELECT * FROM term_events ORDER BY event_date ASC');
        res.render('portal/calendar', {
            title: 'School Calendar',
            student: req.session.student,
            events: events || [],
            school: await getSettings()
        });
    } catch (err) {
        console.error('Portal Calendar Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.viewAnnouncement = async (req, res) => {
    try {
        const id = req.params.id;
        const announcement = await db.get('SELECT * FROM announcements WHERE id = ?', [id]);
        
        if (!announcement) {
            return res.redirect('/portal?error=Announcement not found');
        }

        res.render('portal/announcement', {
            title: announcement.title,
            student: req.session.student,
            school: await getSettings(),
            announcement
        });
    } catch (err) {
        console.error('Portal View Announcement Error:', err);
        res.status(500).send('Database Error');
    }
};

// Assignment view (from class_posts table)
exports.viewAssignment = async (req, res) => {
    try {
        const id = req.params.id;
        const post = await db.get(`
            SELECT cp.*, s.first_name, s.last_name, sub.name as subject_name
            FROM class_posts cp
            LEFT JOIN staff s ON cp.teacher_id = s.id
            LEFT JOIN subjects sub ON cp.subject_id = sub.id
            WHERE cp.id = ?
        `, [id]);

        if (!post) {
            return res.redirect('/portal?error=Assignment or post not found');
        }

        res.render('portal/assignment', {
            title: post.title,
            student: req.session.student,
            school: await getSettings(),
            post
        });
    } catch (err) {
        console.error('Portal View Assignment Error:', err);
        res.status(500).send('Database Error');
    }
};

// ============================================================
// PHASE 3 — ACADEMICS HUB CONTROLLERS
// ============================================================

// Shared helper: resolve student's active class & section context
const getStudentContext = async (studentId, school) => {
    const currentSessionStr = school.current_session || '2024/2025';
    const enrolledClasses = await db.all(`
        SELECT c.id as class_id, c.name as class_name, sec.name as section_name,
               sec.current_session as section_session, sec.current_term as section_term
        FROM student_enrollments se
        JOIN classes c ON se.class_id = c.id
        LEFT JOIN sections sec ON c.section_id = sec.id
        WHERE se.student_id = ? AND se.session = sec.current_session
    `, [studentId]);

    const activeSession = enrolledClasses.length > 0
        ? enrolledClasses[0].section_session || currentSessionStr
        : currentSessionStr;
    const activeTerm = enrolledClasses.length > 0
        ? enrolledClasses[0].section_term || school.current_term || '1st Term'
        : (school.current_term || '1st Term');

    const studentObj = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    if (studentObj) {
        if (enrolledClasses.length > 0) {
            studentObj.class_name = enrolledClasses.map(c => c.class_name).join(', ');
        } else {
            const classRow = studentObj.current_class_id
                ? await db.get('SELECT name FROM classes WHERE id = ?', [studentObj.current_class_id])
                : null;
            studentObj.class_name = classRow ? classRow.name : 'Unassigned';
        }
    }

    const enrolledClassIds = enrolledClasses.length > 0
        ? enrolledClasses.map(c => c.class_id)
        : (studentObj && studentObj.current_class_id ? [studentObj.current_class_id] : []);

    const msgCountObj = await db.get('SELECT COUNT(*) as c FROM class_posts WHERE student_id = ?', [studentId]);
    const individualMessagesCount = msgCountObj ? msgCountObj.c : 0;

    return {
        studentObj,
        enrolledClasses,
        enrolledClassIds,
        activeSession,
        activeTerm,
        individualMessagesCount
    };
};

exports.getAcademicsHub = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        const { studentObj, enrolledClassIds, activeSession, activeTerm, individualMessagesCount } = ctx;

        // Published results summary (latest term)
        const resultSummary = await db.all(`
            SELECT session, term, COUNT(*) as subjects_taken, AVG(total) as average_score
            FROM results
            WHERE student_id = ? AND status IN ('approved', 'published')
            GROUP BY session, term
            ORDER BY session DESC, term DESC
            LIMIT 6
        `, [studentId]);

        // Position for latest term (if published)
        let latestPosition = null, latestClassCount = null;
        if (resultSummary.length > 0) {
            const lr = resultSummary[0];
            // Find class for position calc
            const classForPos = ctx.enrolledClasses.length > 0
                ? ctx.enrolledClasses[0]
                : null;
            if (classForPos) {
                const classPerf = await db.all(`
                    SELECT r.student_id, SUM(r.total) as student_total
                    FROM results r
                    WHERE r.term = ? AND r.session = ?
                    AND r.student_id IN (SELECT student_id FROM student_enrollments WHERE class_id = ? AND session = ?)
                    GROUP BY r.student_id ORDER BY student_total DESC
                `, [lr.term, lr.session, classForPos.class_id, lr.session]);
                latestClassCount = classPerf.length;
                const myPerf = classPerf.find(p => p.student_id == studentId);
                if (myPerf) latestPosition = classPerf.indexOf(myPerf) + 1;
            }
        }

        // Class board recent items
        let classPosts = [];
        if (enrolledClassIds.length > 0) {
            const ph = enrolledClassIds.map(() => '?').join(',');
            classPosts = await db.all(`
                SELECT cp.*, st.first_name, st.last_name, sub.name as subject_name
                FROM class_posts cp
                JOIN staff st ON cp.teacher_id = st.id
                LEFT JOIN subjects sub ON cp.subject_id = sub.id
                WHERE cp.class_id IN (${ph}) AND (cp.student_id IS NULL OR cp.student_id = ?)
                ORDER BY cp.created_at DESC LIMIT 5
            `, [...enrolledClassIds, studentId]);
        }

        // Subjects for current class
        let subjects = [];
        if (enrolledClassIds.length > 0) {
            subjects = await db.all(`
                SELECT sub.id, sub.name, sub.code,
                       st.first_name as teacher_first, st.last_name as teacher_last
                FROM subject_assignments sa
                JOIN subjects sub ON sa.subject_id = sub.id
                LEFT JOIN staff st ON sa.teacher_id = st.id
                WHERE sa.class_id = ? AND sa.session = ?
                ORDER BY sub.name
            `, [enrolledClassIds[0], activeSession]);
        }

        res.render('portal/academics/index', {
            title: 'Academics',
            path: '/portal/academics',
            school, student: studentObj || req.session.student,
            resultSummary, latestPosition, latestClassCount,
            classPosts, subjects,
            currentTerm: activeTerm, currentSession: activeSession,
            individualMessagesCount,
            sectionInfo: ctx.enrolledClasses
        });
    } catch (err) {
        console.error('Academics Hub Error:', err);
        res.status(500).send('Error loading Academics Hub');
    }
};

exports.getAcademicsResults = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        const { studentObj, enrolledClasses, enrolledClassIds, activeSession, activeTerm, individualMessagesCount } = ctx;

        // Selected term/session from query or default to latest published
        const allPublished = await db.all(`
            SELECT DISTINCT session, term FROM results
            WHERE student_id = ? AND status IN ('approved','published')
            ORDER BY session DESC, term DESC
        `, [studentId]);

        const selectedSession = req.query.session || (allPublished[0] ? allPublished[0].session : activeSession);
        const selectedTerm = req.query.term || (allPublished[0] ? allPublished[0].term : activeTerm);

        // Detailed results for selected term
        let detailedResults = [];
        let position = null, classCount = null;
        const classForCalc = enrolledClasses.length > 0 ? enrolledClasses[0] : null;

        if (classForCalc) {
            detailedResults = await db.all(`
                SELECT r.*, sub.name as subject_name, sub.code as subject_code
                FROM results r
                JOIN subjects sub ON r.subject_id = sub.id
                WHERE r.student_id = ? AND r.term = ? AND r.session = ?
                AND r.status IN ('approved','published')
                ORDER BY sub.name
            `, [studentId, selectedTerm, selectedSession]);

            // Position
            const classPerf = await db.all(`
                SELECT r.student_id, SUM(r.total) as student_total
                FROM results r
                WHERE r.term = ? AND r.session = ?
                AND r.student_id IN (SELECT student_id FROM student_enrollments WHERE class_id = ? AND session = ?)
                GROUP BY r.student_id ORDER BY student_total DESC
            `, [selectedTerm, selectedSession, classForCalc.class_id, selectedSession]);
            classCount = classPerf.length;
            const myPerf = classPerf.find(p => p.student_id == studentId);
            if (myPerf) position = classPerf.indexOf(myPerf) + 1;
        }

        // Average
        const avgRow = detailedResults.length > 0
            ? { avg: detailedResults.reduce((s, r) => s + (r.total || 0), 0) / detailedResults.length }
            : null;

        // Previous term for comparison
        const prevTermData = allPublished.find(p => !(p.session === selectedSession && p.term === selectedTerm));
        let prevAvg = null;
        if (prevTermData) {
            const prevRows = await db.all(`
                SELECT AVG(total) as avg FROM results
                WHERE student_id = ? AND term = ? AND session = ? AND status IN ('approved','published')
            `, [studentId, prevTermData.term, prevTermData.session]);
            prevAvg = prevRows[0] ? prevRows[0].avg : null;
        }

        // Result config for section (to know ca_count)
        let resultConfig = { ca_count: '2' };
        if (classForCalc) {
            const configRows = await db.all('SELECT key, value FROM section_result_config WHERE section_id = (SELECT section_id FROM classes WHERE id = ?)', [classForCalc.class_id]);
            configRows.forEach(r => { resultConfig[r.key] = r.value; });
        }

        // Grading system
        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');

        res.render('portal/academics/results', {
            title: 'Results', path: '/portal/academics/results',
            school, student: studentObj || req.session.student,
            allPublished, selectedSession, selectedTerm,
            detailedResults, position, classCount,
            avgRow, prevTermData, prevAvg,
            resultConfig, grading,
            currentTerm: activeTerm, currentSession: activeSession,
            individualMessagesCount, sectionInfo: enrolledClasses
        });
    } catch (err) {
        console.error('Academics Results Error:', err);
        res.status(500).send('Error loading Results');
    }
};

exports.getAcademicsClassBoard = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        const { studentObj, enrolledClassIds, activeSession, activeTerm, individualMessagesCount } = ctx;

        let classPosts = [];
        if (enrolledClassIds.length > 0) {
            const ph = enrolledClassIds.map(() => '?').join(',');
            classPosts = await db.all(`
                SELECT cp.*, st.first_name, st.last_name, sub.name as subject_name
                FROM class_posts cp
                JOIN staff st ON cp.teacher_id = st.id
                LEFT JOIN subjects sub ON cp.subject_id = sub.id
                WHERE cp.class_id IN (${ph}) AND (cp.student_id IS NULL OR cp.student_id = ?)
                ORDER BY cp.created_at DESC
            `, [...enrolledClassIds, studentId]);
        }

        // Classify each post
        const now = new Date();
        const posts = classPosts.map(p => {
            let status = 'general';
            if (p.post_type === 'Assignment') {
                if (p.due_date) {
                    status = new Date(p.due_date) < now ? 'overdue' : 'pending';
                } else {
                    status = 'pending';
                }
            }
            return { ...p, status };
        });

        const filterType = req.query.filter || 'all';

        res.render('portal/academics/class-board', {
            title: 'Class Board', path: '/portal/academics/class-board',
            school, student: studentObj || req.session.student,
            posts, filterType,
            currentTerm: activeTerm, currentSession: activeSession,
            individualMessagesCount, sectionInfo: ctx.enrolledClasses
        });
    } catch (err) {
        console.error('Class Board Error:', err);
        res.status(500).send('Error loading Class Board');
    }
};

exports.getAcademicsSubjects = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        const { studentObj, enrolledClassIds, activeSession, activeTerm, individualMessagesCount } = ctx;

        let subjects = [];
        if (enrolledClassIds.length > 0) {
            subjects = await db.all(`
                SELECT sub.id, sub.name, sub.code,
                       st.first_name as teacher_first, st.last_name as teacher_last
                FROM subject_assignments sa
                JOIN subjects sub ON sa.subject_id = sub.id
                LEFT JOIN staff st ON sa.teacher_id = st.id
                WHERE sa.class_id = ? AND sa.session = ?
                ORDER BY sub.name
            `, [enrolledClassIds[0], activeSession]);
        }

        res.render('portal/academics/subjects', {
            title: 'My Subjects', path: '/portal/academics/subjects',
            school, student: studentObj || req.session.student,
            subjects, currentTerm: activeTerm, currentSession: activeSession,
            individualMessagesCount, sectionInfo: ctx.enrolledClasses
        });
    } catch (err) {
        console.error('Subjects Error:', err);
        res.status(500).send('Error loading Subjects');
    }
};

exports.getAcademicsTimetable = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        res.render('portal/academics/timetable', {
            title: 'Timetable', path: '/portal/academics/timetable',
            school, student: ctx.studentObj || req.session.student,
            timetableAvailable: false,
            currentTerm: ctx.activeTerm, currentSession: ctx.activeSession,
            individualMessagesCount: ctx.individualMessagesCount,
            sectionInfo: ctx.enrolledClasses
        });
    } catch (err) {
        res.status(500).send('Error loading Timetable');
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        const { studentObj, enrolledClassIds, activeSession, activeTerm, individualMessagesCount } = ctx;

        // Enrolled section IDs for section-filtered announcements
        const sectionRows = await db.all(`
            SELECT DISTINCT s.id as section_id
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN sections s ON c.section_id = s.id
            WHERE se.student_id = ? AND se.session = s.current_session
        `, [studentId]);
        const sectionIds = sectionRows.map(r => r.section_id);
        let sectionFilter = sectionIds.length > 0
            ? `AND (section_id IS NULL OR section_id IN (${sectionIds.join(',')}))`
            : `AND section_id IS NULL`;

        const announcements = await db.all(`
            SELECT * FROM announcements
            WHERE is_published = 1 AND (target_role = 'Students' OR target_role = 'All')
            ${sectionFilter}
            ORDER BY created_at DESC
        `);

        // Class posts targeted to this student (individual messages)
        let classPosts = [];
        if (enrolledClassIds.length > 0) {
            const ph = enrolledClassIds.map(() => '?').join(',');
            classPosts = await db.all(`
                SELECT cp.*, st.first_name, st.last_name, sub.name as subject_name
                FROM class_posts cp
                JOIN staff st ON cp.teacher_id = st.id
                LEFT JOIN subjects sub ON cp.subject_id = sub.id
                WHERE cp.class_id IN (${ph}) AND (cp.student_id IS NULL OR cp.student_id = ?)
                ORDER BY cp.created_at DESC
                LIMIT 30
            `, [...enrolledClassIds, studentId]);
        }

        res.render('portal/notifications', {
            title: 'Notifications', path: '/portal/notifications',
            school, student: studentObj || req.session.student,
            announcements, classPosts,
            currentTerm: activeTerm, currentSession: activeSession,
            individualMessagesCount, sectionInfo: ctx.enrolledClasses
        });
    } catch (err) {
        console.error('Notifications Error:', err);
        res.status(500).send('Error loading Notifications');
    }
};

// ============================================================
// PHASE 4 — STUDENT ATTENDANCE CONTROLLER
// ============================================================

exports.getAttendance = async (req, res) => {
    try {
        const studentId = req.session.student.id;
        const school = await getSettings();
        const ctx = await getStudentContext(studentId, school);
        const { studentObj, activeSession, activeTerm, individualMessagesCount } = ctx;

        // Fetch distinct session & term periods with attendance records
        const periods = await db.all(`
            SELECT DISTINCT session, term 
            FROM attendance 
            WHERE student_id = ? 
            ORDER BY session DESC, term DESC
        `, [studentId]);

        const selectedSession = req.query.session || (periods[0] ? periods[0].session : activeSession);
        const selectedTerm = req.query.term || (periods[0] ? periods[0].term : activeTerm);
        const selectedFilter = (req.query.status || 'all').toLowerCase();
        const activeView = req.query.view === 'calendar' ? 'calendar' : 'history';

        // Fetch all attendance records for the selected term & session
        const allTermRecords = await db.all(`
            SELECT id, date, status, reason, reason_type, custom_reason
            FROM attendance
            WHERE student_id = ? AND session = ? AND term = ?
            ORDER BY date DESC
        `, [studentId, selectedSession, selectedTerm]);

        // Summary calculations
        const totalDays = allTermRecords.length;
        const presentCount = allTermRecords.filter(r => r.status === 'Present').length;
        const lateCount = allTermRecords.filter(r => r.status === 'Late').length;
        const absentCount = allTermRecords.filter(r => r.status === 'Absent').length;
        const leaveCount = allTermRecords.filter(r => r.status === 'Leave').length;
        
        const attendanceRate = totalDays > 0 
            ? Math.round(((presentCount + lateCount) / totalDays) * 100) 
            : null;

        // Factual insights
        const recentAbsence = allTermRecords.find(r => r.status === 'Absent');
        const recentLate = allTermRecords.find(r => r.status === 'Late');

        // Check for school term absence limit
        const limitRow = await db.get("SELECT value FROM settings WHERE key = 'attendance.term_absence_limit'");
        const termAbsenceLimit = Number(limitRow ? limitRow.value : 10);

        // Filtered records for History view
        let filteredRecords = allTermRecords;
        if (selectedFilter !== 'all') {
            filteredRecords = allTermRecords.filter(r => r.status.toLowerCase() === selectedFilter);
        }

        // Calendar computation
        let calMonthStr = req.query.month;
        if (!calMonthStr) {
            if (allTermRecords.length > 0) {
                calMonthStr = allTermRecords[0].date.substring(0, 7); // 'YYYY-MM'
            } else {
                const now = new Date();
                calMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            }
        }

        const [calYear, calMonth] = calMonthStr.split('-').map(Number);
        const firstDayOfMonth = new Date(calYear, calMonth - 1, 1);
        const lastDayOfMonth = new Date(calYear, calMonth, 0);
        const daysInMonth = lastDayOfMonth.getDate();
        const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sun, 1 = Mon...

        // Map date -> status for quick lookup in calendar
        const recordsByDate = {};
        allTermRecords.forEach(r => {
            recordsByDate[r.date] = r;
        });

        // Prev and Next month navigation strings
        const prevMonthDate = new Date(calYear, calMonth - 2, 1);
        const nextMonthDate = new Date(calYear, calMonth, 1);
        const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
        const nextMonthStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

        res.render('portal/attendance', {
            title: 'Attendance',
            path: '/portal/attendance',
            school,
            student: studentObj || req.session.student,
            currentTerm: activeTerm,
            currentSession: activeSession,
            selectedTerm,
            selectedSession,
            selectedFilter,
            activeView,
            periods,
            totalDays,
            presentCount,
            lateCount,
            absentCount,
            leaveCount,
            attendanceRate,
            filteredRecords,
            allTermRecords,
            recentAbsence,
            recentLate,
            termAbsenceLimit,
            calendar: {
                year: calYear,
                month: calMonth,
                monthName: firstDayOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                monthStr: calMonthStr,
                prevMonthStr,
                nextMonthStr,
                daysInMonth,
                startDayOfWeek,
                recordsByDate
            },
            individualMessagesCount,
            sectionInfo: ctx.enrolledClasses
        });
    } catch (err) {
        console.error('Portal Attendance Error:', err);
        res.status(500).send('Error loading Attendance');
    }
};
