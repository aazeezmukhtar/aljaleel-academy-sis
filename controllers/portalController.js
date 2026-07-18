const db = require('../utils/db');
const bcrypt = require('bcryptjs');

const getSettings = async () => {
    const rows = await db.all('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
};

exports.getDashboard = async (req, res) => {
    const studentId = req.session.student.id;
    const school = await getSettings();

    // Fetch latest results
    const results = await db.all(`
        SELECT session, term, COUNT(*) as subjects_taken
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
    const sectionIds = enrollments.map(e => e.section_id);
    
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
    const enrolledClassIds = enrollRows.map(r => r.class_id);

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

    const individualMessagesCount = (await db.get('SELECT COUNT(*) as c FROM class_posts WHERE student_id = ?', [studentId])).c;
    
    // Fee Stats for Progress Bar
    const feeStats = await db.get(`
        SELECT 
            SUM(total_amount) as expected,
            SUM(paid_amount) as collected
        FROM student_fees
        WHERE student_id = ?
    `, [studentId]);
    const feeProgress = feeStats.expected > 0 ? Math.round((feeStats.collected / feeStats.expected) * 100) : 0;
    const feeBalance = (feeStats.expected || 0) - (feeStats.collected || 0);
    
    // Fetch upcoming events
    const upcomingEvents = await db.all(`
        SELECT * FROM term_events 
        WHERE event_date >= date('now') 
        ${sectionFilter}
        ORDER BY event_date ASC LIMIT 5
    `);

    // Fetch student data with enrolled classes (including per-section term info)
    const studentObj = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    const enrolledClasses = await db.all(`
        SELECT c.name as class_name, sec.name as section_name, 
               sec.current_session as section_session, sec.current_term as section_term
        FROM student_enrollments se 
        JOIN classes c ON se.class_id = c.id 
        LEFT JOIN sections sec ON c.section_id = sec.id
        WHERE se.student_id = ? AND se.session = sec.current_session
    `, [studentId]);
    
    if (enrolledClasses.length > 0) {
        studentObj.class_name = enrolledClasses.map(c => c.class_name).join(', ');
    } else {
        studentObj.class_name = 'Not Enrolled';
    }

    // Build per-section info for dashboard display
    const sectionInfo = enrolledClasses.map(ec => ({
        class_name: ec.class_name,
        section_name: ec.section_name,
        current_session: ec.section_session || school.current_session || currentSessionStr,
        current_term: ec.section_term || school.current_term || '1st Term'
    }));

    res.render('portal/index', {
        title: 'Student Dashboard',
        path: '/portal',
        school,
        results,
        payments,
        announcements,
        classPosts,
        upcomingEvents: upcomingEvents || [],
        student: studentObj,
        individualMessagesCount,
        feeProgress,
        feeBalance,
        sectionInfo,
        currentTerm: school.current_term || 'First',
        currentSession: school.current_session || '2024/2025',
        error: req.query.error
    });
};

exports.getResults = (req, res) => {
    res.redirect('/portal'); // Or render a dedicated list of previous terms
};

exports.viewTermlyResult = async (req, res) => {
    const term = req.query.term;
    const session = req.query.session;
    const approved = (await db.get(`SELECT COUNT(*) as c FROM results WHERE student_id = ? AND term = ? AND session = ? AND status IN ('approved', 'published')`, [req.session.student.id, term, session])).c;
    if(approved === 0) {
        return res.redirect('/portal?error=Results not yet published by the Administrator.');
    }
    req.params.student_id = req.session.student.id;
    const resultController = require('./resultController');
    await resultController.getReportCard(req, res);
};

exports.viewCumulativeResult = async (req, res) => {
    const session = req.query.session;
    const approved = (await db.get(`SELECT COUNT(*) as c FROM results WHERE student_id = ? AND session = ? AND status IN ('approved', 'published')`, [req.session.student.id, session])).c;
    if(approved === 0) {
        return res.redirect('/portal?error=Results not yet published by the Administrator.');
    }
    req.params.student_id = req.session.student.id;
    const resultController = require('./resultController');
    await resultController.getCumulativeReport(req, res);
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
        const student = await db.get('SELECT password FROM students WHERE id = ?', [studentId]);

        // Support both hashed passwords and legacy plaintext passwords
        let isMatch = false;
        if (student.password && student.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(current_password, student.password);
        } else {
            isMatch = student.password === current_password;
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
            events,
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

// Assignment view
exports.viewAssignment = async (req, res) => {
    try {
        const id = req.params.id;
        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', [id]);
        if (!assignment) {
            return res.redirect('/portal?error=Assignment not found');
        }
        res.render('portal/assignment', {
            title: assignment.title,
            student: req.session.student,
            school: await getSettings(),
            post: assignment
        });
    } catch (err) {
        console.error('Portal View Assignment Error:', err);
        res.status(500).send('Database Error');
    }
};
