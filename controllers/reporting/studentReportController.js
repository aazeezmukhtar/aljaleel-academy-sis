const db = require('../../utils/db');
const { getAcademicContext } = require('../../utils/sessionHelper');

const getStudentDashboard = async (req, res) => {
    const user = req.session.staff;
    try {
        const total = await db.get("SELECT COUNT(*) as count FROM students WHERE status = 'active'");
        const males = await db.get("SELECT COUNT(*) as count FROM students WHERE gender = 'Male' AND status = 'active'");
        const females = await db.get("SELECT COUNT(*) as count FROM students WHERE gender = 'Female' AND status = 'active'");
        
        const year = new Date().getFullYear().toString();
        const yearSql = db.DB_TYPE === 'postgres' 
            ? "SELECT COUNT(*) as count FROM students WHERE EXTRACT(YEAR FROM admission_date)::text = ?"
            : "SELECT COUNT(*) as count FROM students WHERE strftime('%Y', admission_date) = ?";
            
        const newIntake = await db.get(yearSql, [year]);

        res.render('reports/student/index', {
            title: 'Student Reports',
            stats: {
                total: total ? total.count : 0,
                males: males ? males.count : 0,
                females: females ? females.count : 0,
                new_intake: newIntake ? newIntake.count : 0
            },
            user
        });
    } catch (err) {
        console.error('Student Dashboard Error:', err);
        res.status(500).send('Database Error');
    }
};

const getClassListReport = async (req, res) => {
    const user = req.session.staff;
    const { class_id, arm_id } = req.query;

    try {
        let classes;
        if (user.role === 'Admin' || user.role === 'Registrar') {
            classes = await db.all('SELECT * FROM classes ORDER BY name ASC');
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

        let activeClassId = class_id;
        if (!activeClassId && classes && classes.length > 0) {
            activeClassId = classes[0].id;
        }

        let students = [];
        if (activeClassId) {
            let currentSession = '2024/2025';
            try {
                const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
                if (sessionRow && sessionRow.value) currentSession = sessionRow.value;
            } catch (e) {}

            let query = `
                SELECT s.*, c.name as class_name, a.name as arm_name 
                FROM students s
                LEFT JOIN student_enrollments se ON s.id = se.student_id AND se.session = ?
                LEFT JOIN classes c ON (se.class_id = c.id OR s.current_class_id = c.id)
                LEFT JOIN arms a ON s.current_arm_id = a.id
                WHERE (se.class_id = ? OR (s.current_class_id = ? AND se.id IS NULL)) AND s.status = 'active'
            `;
            const params = [currentSession, activeClassId, activeClassId];

            if (arm_id) {
                query += " AND s.current_arm_id = ?";
                params.push(arm_id);
            }

            query += " ORDER BY s.last_name ASC, s.first_name ASC";
            students = await db.all(query, params);

            if (!students || students.length === 0) {
                let fallbackQuery = `
                    SELECT s.*, c.name as class_name, a.name as arm_name 
                    FROM students s
                    LEFT JOIN classes c ON s.current_class_id = c.id
                    LEFT JOIN arms a ON s.current_arm_id = a.id
                    WHERE s.current_class_id = ? AND s.status = 'active'
                `;
                const fallbackParams = [activeClassId];
                if (arm_id) {
                    fallbackQuery += " AND s.current_arm_id = ?";
                    fallbackParams.push(arm_id);
                }
                fallbackQuery += " ORDER BY s.last_name ASC, s.first_name ASC";
                students = await db.all(fallbackQuery, fallbackParams);
            }
        }

        res.render('reports/student/list', {
            title: 'Class List Report',
            classes,
            students: students || [],
            user,
            query: { class_id: activeClassId, arm_id }
        });
    } catch (err) {
        console.error('Class List Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getDemographicsReport = async (req, res) => {
    try {
        const demographics = await db.all(`
            SELECT 
                gender, 
                COUNT(*) as count, 
                ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM students WHERE status='active'), 0), 1) as percentage
            FROM students 
            WHERE status = 'active'
            GROUP BY gender
        `);

        let ageQuery = db.DB_TYPE === 'postgres'
            ? `SELECT 
                CASE 
                    WHEN (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob)) < 10 THEN 'Under 10'
                    WHEN (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob)) BETWEEN 10 AND 12 THEN '10-12 Years'
                    WHEN (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob)) BETWEEN 13 AND 15 THEN '13-15 Years'
                    WHEN (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob)) > 15 THEN '16+ Years'
                    ELSE 'Unknown'
                END as age_range,
                COUNT(*) as count
               FROM students
               WHERE status = 'active'
               GROUP BY age_range
               ORDER BY age_range`
            : `SELECT 
                CASE 
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) < 10 THEN 'Under 10'
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) BETWEEN 10 AND 12 THEN '10-12 Years'
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) BETWEEN 13 AND 15 THEN '13-15 Years'
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) > 15 THEN '16+ Years'
                    ELSE 'Unknown'
                END as age_range,
                COUNT(*) as count
               FROM students
               WHERE status = 'active'
               GROUP BY age_range
               ORDER BY age_range`;

        const ageDistribution = await db.all(ageQuery);

        res.render('reports/student/demographics', {
            title: 'Student Demographics',
            demographics,
            ageDistribution
        });
    } catch (err) {
        console.error('Demographics Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getProfileAuditReport = async (req, res) => {
    try {
        const students = await db.all(`
            SELECT id, first_name, last_name, admission_number, 
                CASE WHEN passport_photo_path IS NULL OR passport_photo_path = '' THEN 1 ELSE 0 END as missing_photo,
                CASE WHEN parent_phone IS NULL OR parent_phone = '' THEN 1 ELSE 0 END as missing_phone,
                CASE WHEN dob IS NULL OR CAST(dob AS TEXT) = '' THEN 1 ELSE 0 END as missing_dob,
                CASE WHEN parent_address IS NULL OR parent_address = '' THEN 1 ELSE 0 END as missing_address
            FROM students
            WHERE status = 'active'
            AND (passport_photo_path IS NULL OR passport_photo_path = '' 
                OR parent_phone IS NULL OR parent_phone = ''
                OR dob IS NULL 
                OR parent_address IS NULL OR parent_address = '')
        `);

        res.render('reports/student/audit', {
            title: 'Student Profile Audit',
            students
        });
    } catch (err) {
        console.error('Profile Audit Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getStudentDashboard,
    getClassListReport,
    getDemographicsReport,
    getProfileAuditReport
};
