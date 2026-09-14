const db = require('../../utils/db');
const sessionHelper = require('../../utils/sessionHelper');

const getAcademicDashboard = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const stats = {
        total_results: (await db.get("SELECT COUNT(r.id) as count FROM results r JOIN students s ON r.student_id = s.id WHERE s.school_id = ?", [schoolId]))?.count || 0,
        subjects: (await db.get("SELECT COUNT(*) as count FROM subjects WHERE school_id = ?", [schoolId]))?.count || 0,
        classes: (await db.get("SELECT COUNT(*) as count FROM classes WHERE school_id = ?", [schoolId]))?.count || 0
    };

    res.render('reports/academic/index', {
        title: 'Academic Reports Dashboard',
        stats,
        user
    });
};

const getBroadsheet = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const { class_id, term, session } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
              AND c.school_id = ?
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id, schoolId]);
    }

    let reportData = null;
    let subjects = [];

    if (class_id && term && session) {
        const clazz = await db.get('SELECT name FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);

        if (clazz) {
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
                  AND st.school_id = ?
                ORDER BY st.last_name, st.first_name
            `, [class_id, session, schoolId]);

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
                class_name: clazz.name,
                term,
                session,
                students: studentsWithResults
            };
        }
    }

    const availableSessions = await sessionHelper.getAvailableSessions(schoolId);

    res.render('reports/academic/broadsheet', {
        title: 'Master Broadsheet',
        classes,
        subjects,
        reportData,
        availableSessions,
        user,
        query: { class_id, term, session }
    });
};

const getSubjectAnalysis = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const { class_id, term, session } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
              AND c.school_id = ?
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id, schoolId]);
    }

    const availableSessions = await sessionHelper.getAvailableSessions(schoolId);

    // Fetch analysis data if filters are provided
    let analysis = [];
    if (class_id && term && session) {
        analysis = await db.all(`
            SELECT s.name AS subject_name,
                   c.name AS class_name,
                   COUNT(DISTINCT r.student_id) AS students_count,
                   AVG(r.total) AS average_score,
                   MAX(r.total) AS highest_score,
                   MIN(r.total) AS lowest_score,
                   SUM(CASE WHEN r.total >= 50 THEN 1 ELSE 0 END) AS pass_count
            FROM results r
            JOIN subjects s ON r.subject_id = s.id
            JOIN student_enrollments se ON r.student_id = se.student_id AND r.session = se.session
            JOIN classes c ON se.class_id = c.id
            WHERE se.class_id = ? AND r.term = ? AND r.session = ?
              AND c.school_id = ?
            GROUP BY s.id, s.name, c.name
            ORDER BY s.name;
        `, [class_id, term, session, schoolId]);
    }

    const totalStudentsResult = await db.get(`
        SELECT COUNT(DISTINCT r.student_id) AS total_students
        FROM results r
        JOIN student_enrollments se ON r.student_id = se.student_id AND r.session = se.session
        JOIN classes c ON se.class_id = c.id
        WHERE se.class_id = ? AND r.term = ? AND r.session = ?
          AND c.school_id = ?
    `, [class_id, term, session, schoolId]);
    const totalStudents = totalStudentsResult ? totalStudentsResult.total_students : 0;

    res.render('reports/academic/analysis', {
        title: 'Subject Analysis',
        classes,
        availableSessions,
        user,
        query: { class_id, term, session },
        analysis,
        totalStudents
    });
};

const getTopPerformers = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const { class_id, term, session, limit } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
              AND c.school_id = ?
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id, schoolId]);
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
              AND s.school_id = ?
            GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
            ORDER BY average_score DESC
            LIMIT ?
        `, [class_id, term, session, schoolId, limit || 10]);
    }

    const availableSessions = await sessionHelper.getAvailableSessions(schoolId);

    res.render('reports/academic/top', {
        title: 'Top Performers',
        classes,
        topStudents,
        availableSessions,
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

