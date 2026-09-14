const db = require('./db');

/**
 * Get students enrolled in a class for a given session.
 * Uses student_enrollments junction table with fallback to current_class_id.
 */
async function getEnrolledStudents(classId, session = null) {
    const classIdNum = Number(classId);

    let enrollmentQuery = `
        SELECT DISTINCT s.id, s.first_name, s.last_name, s.admission_number, 
               s.passport_photo_path, s.gender, s.status
        FROM students s
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_id = ?
    `;
    const params = [classIdNum];
    if (session) {
        enrollmentQuery += " AND se.session = ?";
        params.push(session);
    }
    enrollmentQuery += " AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)";
    enrollmentQuery += " ORDER BY s.last_name, s.first_name";

    let students = await db.all(enrollmentQuery, params);

    // Fallback to current_class_id if no enrollment records found
    if (students.length === 0) {
        let fallbackQuery = `
            SELECT id, first_name, last_name, admission_number, 
                   passport_photo_path, gender, status
            FROM students
            WHERE current_class_id = ?
              AND (status = 'active' OR status = 'Active' OR status IS NULL)
            ORDER BY last_name, first_name
        `;
        students = await db.all(fallbackQuery, [classIdNum]);
    }

    return students;
}

/**
 * Get the section for a given class.
 */
async function getClassSection(classId) {
    const row = await db.get(`
        SELECT s.id, s.name 
        FROM sections s 
        JOIN classes c ON c.section_id = s.id 
        WHERE c.id = ?
    `, [classId]);
    return row || null;
}

/**
 * Get the result config for a specific section or tenant.
 * Hierarchy: section_result_config -> settings[result.*] -> legacy result_config -> safe defaults
 */
async function getSectionResultConfig(sectionId, schoolId) {
    const defaults = { ca_count: 2, ca1_max: 20, ca2_max: 20, exam_max: 60 };

    // 1. Legacy result_config
    const rows = await db.all('SELECT * FROM result_config').catch(() => []);
    rows.forEach(r => { if (r.value !== undefined) defaults[r.key] = parseInt(r.value) || defaults[r.key]; });

    // 2. Resolve school_id from section if missing
    if (sectionId && !schoolId) {
        const sec = await db.get('SELECT school_id FROM sections WHERE id = ?', [sectionId]);
        if (sec && sec.school_id) schoolId = sec.school_id;
    }

    // 3. Tenant settings override
    if (schoolId) {
        const tenantSettings = await db.all(
            "SELECT key, value FROM settings WHERE school_id = ? AND (key LIKE 'result.%' OR key IN ('ca_count', 'ca1_max', 'ca2_max', 'exam_max'))",
            [schoolId]
        );
        tenantSettings.forEach(r => {
            const cleanKey = r.key.startsWith('result.') ? r.key.replace('result.', '') : r.key;
            if (r.value !== undefined && r.value !== null) {
                defaults[cleanKey] = parseInt(r.value) || defaults[cleanKey];
            }
        });
    }

    // 4. Section overrides from section_result_config (key-value rows)
    if (sectionId) {
        const sectionRows = await db.all('SELECT key, value FROM section_result_config WHERE section_id = ?', [sectionId]);
        sectionRows.forEach(r => {
            if (r.value !== undefined && r.value !== null) {
                defaults[r.key] = parseInt(r.value) || defaults[r.key];
            }
        });
    }

    return defaults;
}

module.exports = { getEnrolledStudents, getClassSection, getSectionResultConfig };

