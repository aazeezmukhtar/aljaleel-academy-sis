const db = require('../../utils/db');
<<<<<<< HEAD

const getHealthDashboard = async (req, res) => {
    const user = req.session.staff;
    try {
        const conditions = await db.get("SELECT COUNT(*) as count FROM student_health WHERE medical_conditions IS NOT NULL AND medical_conditions != ''");
        const allergies = await db.get("SELECT COUNT(*) as count FROM student_health WHERE allergies IS NOT NULL AND allergies != ''");
        const bloodGroupA = await db.get("SELECT COUNT(*) as count FROM student_health WHERE blood_group LIKE 'A%'");

        res.render('reports/health/index', {
            title: 'Health & Wellness Reports',
            stats: {
                students_with_conditions: conditions.count,
                students_with_allergies: allergies.count,
                blood_group_a: bloodGroupA.count
            },
            user
        });
    } catch (err) {
        console.error('Health Dashboard Error:', err);
        res.status(500).send('Database Error');
    }
=======
const { getAcademicContext } = require('../../utils/sessionHelper');

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
>>>>>>> local-master
};

const getMedicalAlerts = async (req, res) => {
    const { class_id } = req.query;

<<<<<<< HEAD
    try {
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
            user: req.session.staff,
            query: { class_id }
        });
    } catch (err) {
        console.error('Medical Alerts Error:', err);
        res.status(500).send('Database Error');
    }
=======
    let classes = await db.all('SELECT * FROM classes');
    let medicalRisks = [];

    if (class_id) {
        const context = await getAcademicContext(class_id);
        medicalRisks = await db.all(`
            SELECT s.last_name, s.first_name, s.admission_number, h.allergies, h.medical_conditions, h.blood_group, h.emergency_contact_phone, c.name as class_name
            FROM students s
            JOIN student_health h ON s.id = h.student_id
            JOIN student_enrollments se ON s.id = se.student_id AND se.session = ?
            JOIN classes c ON se.class_id = c.id
            WHERE se.class_id = ? AND s.status = 'active'
            AND ((h.allergies IS NOT NULL AND h.allergies != '') OR (h.medical_conditions IS NOT NULL AND h.medical_conditions != ''))
        `, [context.session, class_id]);
    } else {
        // All students with risks if no class selected
        medicalRisks = await db.all(`
            SELECT s.last_name, s.first_name, s.admission_number, h.allergies, h.medical_conditions, h.blood_group, h.emergency_contact_phone, c.name as class_name
            FROM students s
            JOIN student_health h ON s.id = h.student_id
            JOIN student_enrollments se ON s.id = se.student_id
            JOIN classes c ON se.class_id = c.id
            JOIN sections sec ON c.section_id = sec.id
            WHERE s.status = 'active' AND se.session = sec.current_session
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
>>>>>>> local-master
};

const getEmergencyContacts = async (req, res) => {
    const { class_id } = req.query;

<<<<<<< HEAD
    try {
        let classes = await db.all('SELECT * FROM classes');
        let contacts = [];

        if (class_id) {
            // Note: Schema uses parent_phone instead of guardian_phone. 
            // We'll use COALESCE and try to be compatible.
            contacts = await db.all(`
                SELECT 
                    s.last_name, s.first_name, s.admission_number, c.name as class_name,
                    COALESCE(h.emergency_contact_name, 'Parent') as contact_name,
                    COALESCE(h.emergency_contact_phone, s.parent_phone) as contact_phone,
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
            user: req.session.staff,
            query: { class_id }
        });
    } catch (err) {
        console.error('Emergency Contacts Error:', err);
        res.status(500).send('Database Error');
    }
=======
    let classes = await db.all('SELECT * FROM classes');
    let contacts = [];

    let activeClassId = class_id;
    if (!activeClassId && classes && classes.length > 0) {
        activeClassId = classes[0].id;
    }

    if (activeClassId) {
        let coalesceFunc = "IFNULL";
        if (db.DB_TYPE === 'postgres') coalesceFunc = "COALESCE";

        const context = await getAcademicContext(activeClassId);

        contacts = await db.all(`
            SELECT 
                s.last_name, s.first_name, s.admission_number, c.name as class_name,
                ${coalesceFunc}(h.emergency_contact_name, s.guardian_name) as contact_name,
                ${coalesceFunc}(h.emergency_contact_phone, s.guardian_phone) as contact_phone,
                h.blood_group
            FROM students s
            LEFT JOIN student_health h ON s.id = h.student_id
            JOIN student_enrollments se ON s.id = se.student_id AND se.session = ?
            JOIN classes c ON se.class_id = c.id
            WHERE se.class_id = ? AND s.status = 'active'
            ORDER BY s.first_name, s.last_name
        `, [context.session, activeClassId]);
    }

    res.render('reports/health/contacts', {
        title: 'Emergency Contacts',
        classes,
        contacts,
        query: { class_id: activeClassId }
    });
>>>>>>> local-master
};

module.exports = {
    getHealthDashboard,
    getMedicalAlerts,
    getEmergencyContacts
};
