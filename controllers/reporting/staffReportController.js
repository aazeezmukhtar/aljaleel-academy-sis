const db = require('../../utils/db');

const getStaffDashboard = async (req, res) => {
    const user = req.session.staff;
    const stats = {
        total_staff: (await db.get("SELECT COUNT(*) as count FROM staff WHERE status = 'active'")).count,
        teaching_staff: (await db.get("SELECT COUNT(*) as count FROM staff WHERE role = 'Teacher' AND status = 'active'")).count,
        admins: (await db.get("SELECT COUNT(*) as count FROM staff WHERE role = 'Admin' AND status = 'active'")).count
    };

    res.render('reports/staff/index', {
        title: 'Staff Reports',
        stats,
        user
    });
};

const getStaffDirectory = async (req, res) => {
    const { role, department } = req.query;

    let query = "SELECT * FROM staff WHERE status = 'active'";
    const params = [];

    if (role) {
        query += " AND role = ?";
        params.push(role);
    }
    if (department) {
        query += " AND department = ?"; 
        params.push(department);
    }

    query += " ORDER BY last_name, first_name";
    const staffList = await db.all(query, params);

    res.render('reports/staff/directory', {
        title: 'Staff Directory',
        staffList,
        query: { role, department }
    });
};

const getWorkloadReport = async (req, res) => {
    const staffWorkload = await db.all(`
        SELECT 
            s.id, s.first_name, s.last_name, s.role,
            COUNT(DISTINCT ca.class_id) as class_count,
            COUNT(DISTINCT sa.subject_id) as subject_count
        FROM staff s
        LEFT JOIN class_assignments ca ON s.id = ca.staff_id
        LEFT JOIN subject_assignments sa ON s.id = sa.teacher_id
        WHERE s.status = 'active' AND s.role = 'Teacher'
        GROUP BY s.id, s.first_name, s.last_name, s.role
        ORDER BY class_count DESC, subject_count DESC
    `);

    // Fetch details for each staff
    for (const staff of staffWorkload) {
        staff.classes = (await db.all(`
            SELECT c.name FROM classes c 
            JOIN class_assignments ca ON c.id = ca.class_id 
            WHERE ca.staff_id = ?
        `, [staff.id])).map(c => c.name).join(', ');

        staff.subjects = (await db.all(`
            SELECT sub.name as subject_name, c.name as class_name 
            FROM subjects sub 
            JOIN subject_assignments sa ON sub.id = sa.subject_id 
            JOIN classes c ON sa.class_id = c.id
            WHERE sa.teacher_id = ?
        `, [staff.id])).map(s => `${s.subject_name} (${s.class_name})`).join(', ');
    }

    res.render('reports/staff/workload', {
        title: 'Staff Workload',
        staffWorkload
    });
};

const getActivityLog = async (req, res) => {
    const { staff_id } = req.query;

    let logs = [];
    let staffName = '';

    if (staff_id) {
        const staff = await db.get('SELECT first_name, last_name FROM staff WHERE id = ?', [staff_id]);
        if (staff) staffName = `${staff.last_name}, ${staff.first_name}`;

        logs = await db.all(`
            SELECT * FROM audit_logs 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `, [staff_id]);
    }

    const allStaff = await db.all("SELECT id, first_name, last_name FROM staff WHERE status='active' ORDER BY last_name");

    res.render('reports/staff/activity', {
        title: 'Staff Activity Log',
        logs,
        staffName,
        allStaff,
        query: { staff_id }
    });
};

module.exports = {
    getStaffDashboard,
    getStaffDirectory,
    getWorkloadReport,
    getActivityLog
};
