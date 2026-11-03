const db = require('../../utils/db');
const sessionHelper = require('../../utils/sessionHelper');

const getAcademicDashboard = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (user ? user.school_id : 1);
    const stats = {
        total_results: (await db.get("SELECT COUNT(r.id) as count FROM results r JOIN students s ON r.student_id = s.id WHERE s.school_id = ? AND r.class_id IS NOT NULL AND r.status IN ('approved', 'published')", [schoolId]))?.count || 0,
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

    const canAccessClass = (selectedClassId) => classes.some(item => String(item.id) === String(selectedClassId));

    let reportData = null;
    let subjects = [];

    if (class_id && term && session && canAccessClass(class_id)) {
        const clazz = await db.get('SELECT name FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);

        if (clazz) {
            subjects = await db.all(`
                SELECT DISTINCT s.id, s.name
                FROM subjects s
                JOIN subject_assignments sa ON sa.subject_id = s.id
                WHERE sa.class_id = ? AND sa.session = ?
                ORDER BY s.name
            `, [class_id, session]);

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
                WHERE r.term = ? AND r.session = ?
                  AND r.class_id = ?
                  AND r.status IN ('approved', 'published')
            `, [term, session, class_id]);

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

    const canAccessClass = (selectedClassId) => classes.some(item => String(item.id) === String(selectedClassId));

    const availableSessions = await sessionHelper.getAvailableSessions(schoolId);

    // Fetch analysis data if filters are provided
    let analysis = [];
    if (class_id && term && session && canAccessClass(class_id)) {
        analysis = await db.all(`
            SELECT s.name AS subject_name,
                   c.name AS class_name,
                   COUNT(DISTINCT r.student_id) AS students_count,
                   (SELECT COUNT(DISTINCT se.student_id)
                    FROM student_enrollments se
                    JOIN students st ON st.id = se.student_id
                    WHERE se.class_id = sa.class_id AND se.session = sa.session
                      AND st.school_id = ? AND st.status = 'active') AS eligible_students_count,
                   AVG(r.total) AS average_score,
                   MAX(r.total) AS highest_score,
                   MIN(r.total) AS lowest_score,
                   SUM(CASE WHEN r.total >= 50 THEN 1 ELSE 0 END) AS pass_count
            FROM subject_assignments sa
            JOIN subjects s ON s.id = sa.subject_id
            JOIN classes c ON c.id = sa.class_id AND c.school_id = ?
            LEFT JOIN results r ON r.subject_id = sa.subject_id
                AND r.class_id = sa.class_id
                AND r.term = ? AND r.session = sa.session
                AND r.status IN ('approved', 'published')
            WHERE sa.class_id = ? AND sa.session = ?
            GROUP BY s.id, s.name, c.name, sa.class_id, sa.session
            ORDER BY s.name;
        `, [schoolId, schoolId, term, class_id, session]);
    }

    const totalStudentsResult = (class_id && session && canAccessClass(class_id)) ? await db.get(`
        SELECT COUNT(DISTINCT se.student_id) AS total_students
        FROM student_enrollments se
        JOIN students st ON st.id = se.student_id
        JOIN classes c ON c.id = se.class_id
        WHERE se.class_id = ? AND se.session = ?
          AND st.school_id = ? AND st.status = 'active'
          AND c.school_id = ?
    `, [class_id, session, schoolId, schoolId]) : null;
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

    const canAccessClass = (selectedClassId) => classes.some(item => String(item.id) === String(selectedClassId));

    let topStudents = [];
    if (class_id && term && session && canAccessClass(class_id)) {
        const expectedSubjects = await db.get(
            'SELECT COUNT(DISTINCT subject_id) AS count FROM subject_assignments WHERE class_id = ? AND session = ?',
            [class_id, session]
        );
        const subjectCount = Number(expectedSubjects && expectedSubjects.count) || 0;
        const requestedLimit = Number(limit);
        const safeLimit = [3, 5, 10].includes(requestedLimit) ? requestedLimit : 10;

        if (subjectCount > 0) {
            topStudents = await db.all(`
                SELECT
                    s.first_name, s.last_name, s.admission_number,
                    c.name as class_name,
                    COUNT(DISTINCT r.subject_id) as subjects_sat,
                    SUM(r.total) as total_score,
                    AVG(r.total) as average_score
                FROM students s
                JOIN results r ON s.id = r.student_id
                JOIN classes c ON c.id = r.class_id
                WHERE r.class_id = ? AND r.term = ? AND r.session = ?
                  AND r.status IN ('approved', 'published')
                  AND s.school_id = ? AND c.school_id = ?
                GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
                HAVING COUNT(DISTINCT r.subject_id) = ?
                ORDER BY average_score DESC, s.last_name ASC, s.first_name ASC
                LIMIT ?
            `, [class_id, term, session, schoolId, schoolId, subjectCount, safeLimit]);
        }
    }

    const availableSessions = await sessionHelper.getAvailableSessions(schoolId);

    res.render('reports/academic/top', {
        title: 'Top Performers',
        classes,
        topStudents,
        availableSessions,
        user,
        query: { class_id, term, session, limit: [3, 5, 10].includes(Number(limit)) ? Number(limit) : 10 }
    });
};

module.exports = {
    getAcademicDashboard,
    getBroadsheet,
    getSubjectAnalysis,
    getTopPerformers
};

