const db = require('../../utils/db');

const getAcademicDashboard = async (req, res) => {
    const user = req.session.staff;
    const stats = {
        total_results: (await db.get("SELECT COUNT(*) as count FROM results")).count,
        subjects: (await db.get("SELECT COUNT(*) as count FROM subjects")).count,
        classes: (await db.get("SELECT COUNT(*) as count FROM classes")).count
    };

    res.render('reports/academic/index', {
        title: 'Academic Reports Dashboard',
        stats,
        user
    });
};

const getBroadsheet = async (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = await db.all('SELECT * FROM classes');
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id]);
    }

    let reportData = null;
    let subjects = [];

    if (class_id && term && session) {
        const clazz = await db.get('SELECT name FROM classes WHERE id = ?', [class_id]);

        subjects = await db.all(`
            SELECT DISTINCT s.id, s.name
            FROM subjects s
            JOIN results r ON s.id = r.subject_id
            JOIN student_enrollments se ON r.student_id = se.student_id AND r.session = se.session
            WHERE se.class_id = ? AND r.term = ? AND r.session = ?
            ORDER BY s.name
        `, [class_id, term, session]);

        // All active students in the class
        const students = await db.all(`
            SELECT DISTINCT st.id, st.first_name, st.last_name, st.admission_number
            FROM students st
            JOIN student_enrollments se ON st.id = se.student_id
            WHERE se.class_id = ? AND se.session = ? AND st.status = 'active'
            ORDER BY st.last_name, st.first_name
        `, [class_id, session]);

        // All results for this class/term/session
        const allResults = await db.all(`
            SELECT r.student_id, r.subject_id, r.total, r.grade
            FROM results r
            JOIN student_enrollments se ON r.student_id = se.student_id AND r.session = se.session
            WHERE se.class_id = ? AND r.term = ? AND r.session = ?
        `, [class_id, term, session]);

        // Build result lookup map: resultMap[student_id][subject_id]
        const resultMap = {};
        allResults.forEach(r => {
            if (!resultMap[r.student_id]) resultMap[r.student_id] = {};
            resultMap[r.student_id][r.subject_id] = { total: r.total, grade: r.grade };
        });

        // Augment students with results + totals
        const studentsWithResults = students.map(st => {
            const results = resultMap[st.id] || {};
            const scores = Object.values(results).map(r => r.total);
            const total_score = scores.reduce((a, b) => a + b, 0);
            const average = scores.length > 0 ? (total_score / scores.length).toFixed(1) : '-';
            return { ...st, results, total_score, average };
        });

        // Sort by total score descending
        studentsWithResults.sort((a, b) => b.total_score - a.total_score);

        reportData = {
            class_name: clazz ? clazz.name : 'Unknown Class',
            term,
            session,
            students: studentsWithResults
        };
    }

    res.render('reports/academic/broadsheet', {
        title: 'Master Broadsheet',
        classes,
        subjects,
        reportData,
        user,
        query: { class_id, term, session }
    });
};

const getSubjectAnalysis = async (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = await db.all('SELECT * FROM classes');
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id]);
    }

    res.render('reports/academic/analysis', {
        title: 'Subject Analysis',
        classes,
        user,
        query: { class_id, term, session }
    });
};

const getTopPerformers = async (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session, limit } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = await db.all('SELECT * FROM classes');
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id]);
    }

    let topStudents = [];
    if (class_id && term && session) {
        topStudents = await db.all(`
            SELECT 
                s.first_name, s.last_name, s.admission_number,
                c.name as class_name,
                COUNT(r.id) as subjects_sat,
                SUM(r.total) as total_score,
                AVG(r.total) as average_score
            FROM students s
            JOIN results r ON s.id = r.student_id
            JOIN student_enrollments se ON s.id = se.student_id AND se.session = r.session
            JOIN classes c ON se.class_id = c.id
            WHERE se.class_id = ? AND r.term = ? AND r.session = ?
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
            ORDER BY average_score DESC
            LIMIT ?
        `, [class_id, term, session, limit || 10]);
    }

    res.render('reports/academic/top', {
        title: 'Top Performers',
        classes,
        topStudents,
        user,
        query: { class_id, term, session, limit: limit || 10 }
    });
};

module.exports = {
    getAcademicDashboard,
    getBroadsheet,
    getSubjectAnalysis,
    getTopPerformers
};
