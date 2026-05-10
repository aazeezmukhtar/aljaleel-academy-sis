const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../../database.sqlite'));

const getStudentDashboard = (req, res) => {
    const user = req.session.staff;
    const stats = {
        total: db.prepare("SELECT COUNT(*) as count FROM students WHERE status = 'active'").get().count,
        males: db.prepare("SELECT COUNT(*) as count FROM students WHERE gender = 'Male' AND status = 'active'").get().count,
        females: db.prepare("SELECT COUNT(*) as count FROM students WHERE gender = 'Female' AND status = 'active'").get().count,
        new_intake: db.prepare("SELECT COUNT(*) as count FROM students WHERE strftime('%Y', admission_date) = ?").get(new Date().getFullYear().toString()).count
    };

    res.render('reports/student/index', {
        title: 'Student Reports',
        stats,
        user
    });
};

const getClassListReport = (req, res) => {
    const user = req.session.staff;
    const { class_id, arm_id } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = db.prepare('SELECT * FROM classes').all();
    } else {
        classes = db.prepare(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `).all(user.id, user.id, user.id);
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
        students = db.prepare(query).all(...params);
    }

    res.render('reports/student/list', {
        title: 'Class List Report',
        classes,
        students,
        user,
        query: { class_id, arm_id }
    });
};

const getDemographicsReport = (req, res) => {
    const demographics = db.prepare(`
        SELECT 
            gender, 
            COUNT(*) as count, 
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM students WHERE status='active'), 1) as percentage
        FROM students 
        WHERE status = 'active'
        GROUP BY gender
    `).all();

    const ageDistribution = db.prepare(`
        SELECT 
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
        ORDER BY age_range
    `).all();

    res.render('reports/student/demographics', {
        title: 'Student Demographics',
        demographics,
        ageDistribution
    });
};

const getProfileAuditReport = (req, res) => {
    // Determine missing fields
    const students = db.prepare(`
        SELECT id, first_name, last_name, admission_number, 
               CASE WHEN passport_photo_path IS NULL OR passport_photo_path = '' THEN 1 ELSE 0 END as missing_photo,
               CASE WHEN guardian_phone IS NULL OR guardian_phone = '' THEN 1 ELSE 0 END as missing_phone,
               CASE WHEN dob IS NULL OR dob = '' THEN 1 ELSE 0 END as missing_dob,
               CASE WHEN address IS NULL OR address = '' THEN 1 ELSE 0 END as missing_address
        FROM students
        WHERE status = 'active'
        AND (passport_photo_path IS NULL OR passport_photo_path = '' 
             OR guardian_phone IS NULL OR guardian_phone = ''
             OR dob IS NULL OR dob = ''
             OR address IS NULL OR address = '')
    `).all();

    res.render('reports/student/audit', {
        title: 'Student Profile Audit',
        students
    });
};

module.exports = {
    getStudentDashboard,
    getClassListReport,
    getDemographicsReport,
    getProfileAuditReport
};
