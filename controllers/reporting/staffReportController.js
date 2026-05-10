const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../../database.sqlite'));

const getStaffDashboard = (req, res) => {
    const user = req.session.staff;
    const stats = {
        total_staff: db.prepare("SELECT COUNT(*) as count FROM staff WHERE status = 'active'").get().count,
        teaching_staff: db.prepare("SELECT COUNT(*) as count FROM staff WHERE role = 'Teacher' AND status = 'active'").get().count,
        admins: db.prepare("SELECT COUNT(*) as count FROM staff WHERE role = 'Admin' AND status = 'active'").get().count
    };

    res.render('reports/staff/index', {
        title: 'Staff Reports',
        stats,
        user
    });
};

const getStaffDirectory = (req, res) => {
    const { role, department } = req.query;

    let query = "SELECT * FROM staff WHERE status = 'active'";
    const params = [];

    if (role) {
        query += " AND role = ?";
        params.push(role);
    }
    if (department) {
        query += " AND department = ?"; // Assuming column exists, or we filter later
        params.push(department);
    }

    query += " ORDER BY last_name, first_name";
    const staffList = db.prepare(query).all(...params);

    res.render('reports/staff/directory', {
        title: 'Staff Directory',
        staffList,
        query: { role, department }
    });
};

const getWorkloadReport = (req, res) => {
    const staffWorkload = db.prepare(`
        SELECT 
            s.id, s.first_name, s.last_name, s.role,
            COUNT(DISTINCT ca.class_id) as class_count,
            COUNT(DISTINCT sa.subject_id) as subject_count
        FROM staff s
        LEFT JOIN class_assignments ca ON s.id = ca.staff_id
        LEFT JOIN subject_assignments sa ON s.id = sa.staff_id
        WHERE s.status = 'active' AND s.role = 'Teacher'
        GROUP BY s.id
        ORDER BY class_count DESC, subject_count DESC
    `).all();

    // Fetch details for each staff
    staffWorkload.forEach(staff => {
        staff.classes = db.prepare(`
            SELECT c.name FROM classes c 
            JOIN class_assignments ca ON c.id = ca.class_id 
            WHERE ca.staff_id = ?
        `).all(staff.id).map(c => c.name).join(', ');

        staff.subjects = db.prepare(`
            SELECT sub.name FROM subjects sub 
            JOIN subject_assignments sa ON sub.id = sa.subject_id 
            WHERE sa.staff_id = ?
        `).all(staff.id).map(s => s.name).join(', ');
    });

    res.render('reports/staff/workload', {
        title: 'Staff Workload',
        staffWorkload
    });
};

const getActivityLog = (req, res) => {
    // This is similar to system audit but potentially filtered or summarized per staff
    const { staff_id } = req.query;

    let logs = [];
    let staffName = '';

    if (staff_id) {
        const staff = db.prepare('SELECT first_name, last_name FROM staff WHERE id = ?').get(staff_id);
        if (staff) staffName = `${staff.last_name}, ${staff.first_name}`;

        logs = db.prepare(`
            SELECT * FROM audit_logs 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `).all(staff_id);
    }

    const allStaff = db.prepare("SELECT id, first_name, last_name FROM staff WHERE status='active' ORDER BY last_name").all();

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
