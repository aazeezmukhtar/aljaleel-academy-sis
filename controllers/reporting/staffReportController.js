const db = require('../../utils/db');

const getStaffDashboard = async (req, res) => {
    const user = req.session.staff;
    try {
        const total = await db.get("SELECT COUNT(*) as count FROM staff WHERE status = 'active'");
        const teaching = await db.get("SELECT COUNT(*) as count FROM staff WHERE role = 'Teacher' AND status = 'active'");
        const admins = await db.get("SELECT COUNT(*) as count FROM staff WHERE role = 'Admin' AND status = 'active'");

        res.render('reports/staff/index', {
            title: 'Staff Reports',
            stats: {
                total_staff: total.count,
                teaching_staff: teaching.count,
                admins: admins.count
            },
            user
        });
    } catch (err) {
        console.error('Staff Dashboard Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStaffDirectory = async (req, res) => {
    const { role, department } = req.query;

    try {
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
    } catch (err) {
        console.error('Staff Directory Error:', err);
        res.status(500).send('Database Error');
    }
};

const getWorkloadReport = async (req, res) => {
    try {
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
            const classes = await db.all(`
                SELECT c.name FROM classes c 
                JOIN class_assignments ca ON c.id = ca.class_id 
                WHERE ca.staff_id = ?
            `, [staff.id]);
            staff.classes = classes.map(c => c.name).join(', ');

            const subjects = await db.all(`
                SELECT sub.name FROM subjects sub 
                JOIN subject_assignments sa ON sub.id = sa.subject_id 
                WHERE sa.teacher_id = ?
            `, [staff.id]);
            staff.subjects = subjects.map(s => s.name).join(', ');
        }

        res.render('reports/staff/workload', {
            title: 'Staff Workload',
            staffWorkload
        });
    } catch (err) {
        console.error('Workload Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getActivityLog = async (req, res) => {
    const { staff_id } = req.query;

    try {
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
    } catch (err) {
        console.error('Activity Log Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getStaffDashboard,
    getStaffDirectory,
    getWorkloadReport,
    getActivityLog
};
