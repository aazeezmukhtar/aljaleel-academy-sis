const db = require('../../utils/db');

const getHealthDashboard = async (req, res) => {
    const user = req.session.staff;
    const stats = {
        students_with_conditions: (await db.get("SELECT COUNT(*) as count FROM student_health WHERE medical_conditions IS NOT NULL AND medical_conditions != ''")).count,
        students_with_allergies: (await db.get("SELECT COUNT(*) as count FROM student_health WHERE allergies IS NOT NULL AND allergies != ''")).count,
        blood_group_a: (await db.get("SELECT COUNT(*) as count FROM student_health WHERE blood_group LIKE 'A%'")).count
    };

    res.render('reports/health/index', {
        title: 'Health & Wellness Reports',
        stats,
        user
    });
};

const getMedicalAlerts = async (req, res) => {
    const { class_id } = req.query;

    let classes = await db.all('SELECT * FROM classes');
    let medicalRisks = [];

    if (class_id) {
        medicalRisks = await db.all(`
            SELECT s.last_name, s.first_name, s.admission_number, h.allergies, h.medical_conditions, h.blood_group, h.emergency_contact_phone, c.name as class_name
            FROM students s
            JOIN student_health h ON s.id = h.student_id
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.current_class_id = ? AND s.status = 'active'
            AND ((h.allergies IS NOT NULL AND h.allergies != '') OR (h.medical_conditions IS NOT NULL AND h.medical_conditions != ''))
        `, [class_id]);
    } else {
        // All students with risks if no class selected
        medicalRisks = await db.all(`
            SELECT s.last_name, s.first_name, s.admission_number, h.allergies, h.medical_conditions, h.blood_group, h.emergency_contact_phone, c.name as class_name
            FROM students s
            JOIN student_health h ON s.id = h.student_id
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.status = 'active'
            AND ((h.allergies IS NOT NULL AND h.allergies != '') OR (h.medical_conditions IS NOT NULL AND h.medical_conditions != ''))
            ORDER BY c.name, s.last_name
        `);
    }

    res.render('reports/health/alerts', {
        title: 'Medical Alerts',
        classes,
        medicalRisks,
        query: { class_id }
    });
};

const getEmergencyContacts = async (req, res) => {
    const { class_id } = req.query;

    let classes = await db.all('SELECT * FROM classes');
    let contacts = [];

    if (class_id) {
        let coalesceFunc = "IFNULL";
        if (db.DB_TYPE === 'postgres') coalesceFunc = "COALESCE";

        contacts = await db.all(`
            SELECT 
                s.last_name, s.first_name, s.admission_number, c.name as class_name,
                ${coalesceFunc}(h.emergency_contact_name, s.guardian_name) as contact_name,
                ${coalesceFunc}(h.emergency_contact_phone, s.guardian_phone) as contact_phone,
                h.blood_group
            FROM students s
            LEFT JOIN student_health h ON s.id = h.student_id
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.current_class_id = ? AND s.status = 'active'
            ORDER BY s.last_name
        `, [class_id]);
    }

    res.render('reports/health/contacts', {
        title: 'Emergency Contacts',
        classes,
        contacts,
        query: { class_id }
    });
};

module.exports = {
    getHealthDashboard,
    getMedicalAlerts,
    getEmergencyContacts
};
