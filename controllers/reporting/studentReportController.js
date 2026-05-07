const db = require('../../utils/db');

const getStudentDashboard = async (req, res) => {
    const user = req.session.staff;
    try {
        const total = await db.get("SELECT COUNT(*) as count FROM students WHERE status = 'active'");
        const males = await db.get("SELECT COUNT(*) as count FROM students WHERE gender = 'Male' AND status = 'active'");
        const females = await db.get("SELECT COUNT(*) as count FROM students WHERE gender = 'Female' AND status = 'active'");
        
        const yearSql = db.DB_TYPE === 'postgres' 
            ? "SELECT COUNT(*) as count FROM students WHERE EXTRACT(YEAR FROM admission_date)::text = ?"
            : "SELECT COUNT(*) as count FROM students WHERE strftime('%Y', admission_date) = ?";
            
        const newIntake = await db.get(yearSql, [new Date().getFullYear().toString()]);

        res.render('reports/student/index', {
            title: 'Student Reports',
            stats: {
                total: total.count,
                males: males.count,
                females: females.count,
                new_intake: newIntake.count
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

        let students = [];
        if (class_id) {
            let query = `
                SELECT s.*, c.name as class_name, a.name as arm_name 
                FROM students s
                LEFT JOIN classes c ON s.current_class_id = c.id
                LEFT JOIN arms a ON s.current_arm_id = a.id
                WHERE s.current_class_id = ? AND s.status = 'active'
            `;
            const params = [class_id];

            if (arm_id) {
                query += " AND s.current_arm_id = ?";
                params.push(arm_id);
            }

            query += " ORDER BY s.last_name, s.first_name";
            students = await db.all(query, params);
        }

        res.render('reports/student/list', {
            title: 'Class List Report',
            classes,
            students,
            user,
            query: { class_id, arm_id }
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
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM students WHERE status='active'), 1) as percentage
            FROM students 
            WHERE status = 'active'
            GROUP BY gender
        `);

        const ageSql = db.DB_TYPE === 'postgres'
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

        const ageDistribution = await db.all(ageSql);

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
