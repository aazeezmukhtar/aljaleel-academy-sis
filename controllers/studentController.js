const db = require('../utils/db');
const { getAcademicContext, getSectionContext, getCurrentSession } = require('../utils/sessionHelper');
const { logAction } = require('../utils/logger');
const { generateUniqueID } = require('../utils/idHelper');
const bcrypt = require('bcryptjs');

const getStudents = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { search, class_id, gender, status, section_id, admission_year } = req.query;

    let classes;
    if (user.role === 'Admin' || user.role === 'Registrar') {
        classes = await db.all(
            'SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id WHERE c.id != 0 AND c.school_id = ? ORDER BY c.name ASC',
            [schoolId]
        );
    } else {
        classes = await db.all(`
            SELECT DISTINCT c.*, s.name as section_name 
            FROM classes c
            LEFT JOIN sections s ON c.section_id = s.id
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
              AND c.school_id = ?
            ORDER BY c.name ASC
        `, [user.id, user.id, user.id, schoolId]);
    }

    const sections = await db.all(
        'SELECT * FROM sections WHERE school_id = ? ORDER BY name ASC',
        [schoolId]
    );

    // Fetch distinct statuses in DB for this school
    const statusRows = await db.all(
        "SELECT DISTINCT status FROM students WHERE status IS NOT NULL AND status != '' AND school_id = ? ORDER BY status ASC",
        [schoolId]
    );
    const statuses = statusRows.map(r => r.status);
    if (!statuses.includes('active')) statuses.unshift('active');

    // Fetch distinct admission years
    const yearSql = db.DB_TYPE === 'postgres'
        ? "SELECT DISTINCT EXTRACT(YEAR FROM admission_date)::text as year FROM students WHERE admission_date IS NOT NULL AND school_id = $1 ORDER BY year DESC"
        : "SELECT DISTINCT strftime('%Y', admission_date) as year FROM students WHERE admission_date IS NOT NULL AND strftime('%Y', admission_date) IS NOT NULL AND school_id = ? ORDER BY year DESC";
    const yearRows = await db.all(yearSql, [schoolId]).catch(() => []);
    const admissionYears = yearRows.map(r => r.year).filter(Boolean);

    let query = `
        SELECT s.*, c.name as class_name, c.section_id as class_section_id, se.class_id as enrolled_class_id
        FROM students s
        LEFT JOIN student_enrollments se ON s.id = se.student_id AND se.session = (
            SELECT sec.current_session 
            FROM sections sec 
            JOIN classes cl ON cl.section_id = sec.id 
            WHERE cl.id = se.class_id
        )
        LEFT JOIN classes c ON (se.class_id = c.id OR s.current_class_id = c.id)
        WHERE s.school_id = ?
    `;
    const params = [schoolId];

    let myClasses = [];
    if (user.role !== 'Admin' && user.role !== 'Registrar') {
        myClasses = classes.map(c => c.id);
        if (myClasses.length > 0) {
            query += ` AND (se.class_id IN (${myClasses.join(',')}) OR s.current_class_id IN (${myClasses.join(',')}))`;
        } else {
            query += ` AND s.current_class_id = -1`; // Return none
        }
    }

    if (class_id) {
        query += ` AND (se.class_id = ? OR s.current_class_id = ?)`;
        params.push(class_id, class_id);
    }

    if (gender) {
        query += ` AND s.gender = ?`;
        params.push(gender);
    }

    if (status) {
        query += ` AND s.status = ?`;
        params.push(status);
    }

    if (section_id) {
        query += ` AND c.section_id = ?`;
        params.push(section_id);
    }

    if (admission_year) {
        if (db.DB_TYPE === 'postgres') {
            query += ` AND EXTRACT(YEAR FROM s.admission_date)::text = ?`;
        } else {
            query += ` AND strftime('%Y', s.admission_date) = ?`;
        }
        params.push(admission_year);
    }

    if (search && search.trim() !== '') {
        const like = `%${search.trim().toLowerCase()}%`;
        query += ` AND (
            LOWER(s.first_name) LIKE ? 
            OR LOWER(s.last_name) LIKE ? 
            OR LOWER(s.first_name || ' ' || s.last_name) LIKE ?
            OR LOWER(s.last_name || ' ' || s.first_name) LIKE ?
            OR LOWER(s.last_name || ', ' || s.first_name) LIKE ?
            OR LOWER(s.admission_number) LIKE ?
            OR CAST(s.id AS TEXT) LIKE ?
            OR LOWER(s.parent_phone) LIKE ?
            OR LOWER(s.parent_address) LIKE ?
        )`;
        params.push(like, like, like, like, like, like, like, like, like);
    }

    query += ` ORDER BY s.first_name ASC, s.last_name ASC`;

    try {
        const rows = await db.all(query, params);

        const studentMap = new Map();
        for (const row of rows) {
            if (!studentMap.has(row.id)) {
                studentMap.set(row.id, {
                    ...row,
                    class_names: row.class_name ? [row.class_name] : [],
                    class_ids: row.enrolled_class_id ? [row.enrolled_class_id] : []
                });
            } else {
                if (row.class_name && !studentMap.get(row.id).class_names.includes(row.class_name)) {
                    studentMap.get(row.id).class_names.push(row.class_name);
                }
                if (row.enrolled_class_id && !studentMap.get(row.id).class_ids.includes(row.enrolled_class_id)) {
                    studentMap.get(row.id).class_ids.push(row.enrolled_class_id);
                }
            }
        }
        
        const students = Array.from(studentMap.values()).map(s => {
            s.class_name = s.class_names.length > 0 ? s.class_names.join(', ') : (s.class_name || 'Not Enrolled');
            s.enrolled_class_ids = s.class_ids.join(',');
            return s;
        });

        // Handle AJAX JSON request for smooth client-side filtering without full page reload
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({
                success: true,
                count: students.length,
                students
            });
        }

        res.render('students/index', {
            title: 'Student Management',
            students,
            classes,
            sections,
            statuses,
            admissionYears,
            user,
            filters: {
                search: search || '',
                class_id: class_id || '',
                gender: gender || '',
                status: status || '',
                section_id: section_id || '',
                admission_year: admission_year || ''
            }
        });
    } catch (err) {
        console.error('Fetch Students Error:', err);
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ success: false, message: 'Database Error' });
        }
        res.status(500).send('Database Error');
    }
};

const getEnrollmentForm = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const user = req.session.staff;
        let classes;
        if (user.role === 'Admin' || user.role === 'Registrar') {
            classes = await db.all(
                'SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id WHERE c.school_id = ? ORDER BY c.name ASC',
                [schoolId]
            );
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.*, s.name as section_name 
                FROM classes c
                LEFT JOIN sections s ON c.section_id = s.id
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
                  AND c.school_id = ?
                ORDER BY c.name ASC
            `, [user.id, user.id, user.id, schoolId]);
        }

        const sections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY name ASC',
            [schoolId]
        );

        const activeSession = await getCurrentSession(schoolId);

        res.render('students/enroll', {
            title: 'Enroll New Student',
            classes,
            sections,
            activeSession
        });
    } catch (err) {
        console.error('Fetch Metadata Error:', err);
        res.status(500).send('Database Error');
    }
};

const enrollStudent = async (req, res) => {
    const user = req.session.staff;
    if (!user || (user.role !== 'Admin' && user.role !== 'Registrar')) {
        return res.status(403).send('Access Denied: Admin or Registrar privileges required');
    }
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const {
        first_name,
        last_name,
        gender,
        dob,
        current_class_id,
        phone,
        email,
        address,
        parent_phone,
        parent_address,
        parent_email,
        parent_phone_alt
    } = req.body;
    
    const admission_number = await generateUniqueID();
    const passport_photo_path = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const allSections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY id ASC',
            [schoolId]
        );

        // Collect class assignments across sections
        const enrolledClassIds = [];
        let primary_class_id = current_class_id || null;

        for (const sec of allSections) {
            const classVal = req.body[`section_${sec.id}_class_id`] || 
                             (sec.name === 'Academy' ? req.body.academy_class_id : null) || 
                             (sec.name === 'Tahfeez' ? req.body.tahfeez_class_id : null);
            if (classVal) {
                enrolledClassIds.push({ sectionId: sec.id, classId: parseInt(classVal, 10) });
                if (!primary_class_id) primary_class_id = classVal;
            }
        }

        // If no section-specific class was selected but a primary class was provided, resolve its section
        if (primary_class_id && enrolledClassIds.length === 0) {
            const classRow = await db.get(
                'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
                [primary_class_id, schoolId]
            );
            if (classRow) {
                enrolledClassIds.push({ sectionId: classRow.section_id, classId: classRow.id });
            }
        }

        const hashedPassword = await bcrypt.hash(admission_number, 10);
        const sql = `
            INSERT INTO students (
                school_id, first_name, last_name, gender, dob, current_class_id, 
                phone, email, address, parent_phone, parent_address, parent_email, parent_phone_alt, 
                admission_number, passport_photo_path, password, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `;
        await db.run(sql, [
            schoolId, first_name, last_name, gender, dob, primary_class_id,
            phone || null, email || null, address || null,
            parent_phone || null, parent_address || null,
            parent_email || null, parent_phone_alt || null,
            admission_number, passport_photo_path, hashedPassword
        ]);
        
        const studentRow = await db.get(
            "SELECT id FROM students WHERE admission_number = ? AND school_id = ?",
            [admission_number, schoolId]
        );
        const studentId = studentRow.id;
        
        const activeSession = await getCurrentSession(schoolId);
        for (const item of enrolledClassIds) {
            const context = await getSectionContext(item.sectionId, schoolId);
            const sessionToUse = (context && context.session) || activeSession || '2026/2027';
            await db.run(
                "INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)",
                [studentId, item.classId, sessionToUse]
            );
        }
        
        logAction(req.session.staff.id, 'ENROLL_STUDENT', 'STUDENT', { first_name, last_name }, req.ip);
        res.redirect('/students?success=true');
    } catch (err) {
        console.error('Enroll Error:', err);
        res.redirect('/students/enroll?error=Enrollment failed');
    }
};

const getStudentProfile = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    try {
        const student = await db.get(
            'SELECT * FROM students WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (!student) return res.status(404).send('Student not found');

        const enrollments = await db.all(`
            SELECT c.name as class_name
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN sections sec ON c.section_id = sec.id
            WHERE se.student_id = ? AND se.session = sec.current_session
        `, [id]);

        student.class_name = enrollments.map(e => e.class_name).join(', ') || student.class_name || 'Not Enrolled';

        const feeRow = await db.get(`
            SELECT COALESCE(SUM(total_amount), 0) as total_owed, COALESCE(SUM(paid_amount), 0) as total_paid
            FROM student_fees WHERE student_id = ?
        `, [id]);
        const fees = feeRow || { total_owed: 0, total_paid: 0 };

        const health = await db.get('SELECT * FROM student_health WHERE student_id = ?', [id]) || {};

        const academicTerms = await db.all(`
            SELECT DISTINCT term, session FROM results WHERE student_id = ? ORDER BY session DESC, term ASC
        `, [id]);

        const success = req.query.success || null;
        const error = req.query.error || null;

        res.render('students/view', {
            title: `Student Profile`,
            student,
            fees,
            health,
            academicTerms,
            success,
            error,
            user: req.session.staff
        });
    } catch (err) {
        console.error('Fetch Profile Error:', err);
        res.status(500).send('Database Error');
    }
};

const getEditForm = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    const user = req.session.staff;
    try {
        const student = await db.get(
            'SELECT * FROM students WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (!student) return res.status(404).send('Student not found');

        if (student && student.dob) {
            const d = new Date(student.dob);
            if (!isNaN(d.getTime())) {
                student.dob = d.toISOString().slice(0, 10);
            }
        }
        
        const enrollments = await db.all(`
            SELECT se.class_id 
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN sections sec ON c.section_id = sec.id
            WHERE se.student_id = ? AND se.session = sec.current_session
        `, [id]);
        const enrolledClassIds = enrollments.map(e => e.class_id);

        let classes;
        if (user.role === 'Admin' || user.role === 'Registrar') {
            classes = await db.all(
                'SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id WHERE c.school_id = ? ORDER BY c.name ASC',
                [schoolId]
            );
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.*, s.name as section_name 
                FROM classes c
                LEFT JOIN sections s ON c.section_id = s.id
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                WHERE (c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL)
                  AND c.school_id = ?
                ORDER BY c.name ASC
            `, [user.id, user.id, user.id, schoolId]);
        }
        const sections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY name ASC',
            [schoolId]
        );

        res.render('students/edit', {
            title: `Edit Student: ${student.first_name} ${student.last_name}`,
            student,
            classes,
            sections,
            enrolledClassIds
        });
    } catch (err) {
        console.error('Fetch Edit Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const updateStudent = async (req, res) => {
    const user = req.session.staff;
    if (!user || (user.role !== 'Admin' && user.role !== 'Registrar')) {
        return res.status(403).json({ success: false, message: 'Access Denied: Admin or Registrar privileges required' });
    }
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    const {
        first_name,
        last_name,
        gender,
        dob,
        admission_number,
        current_class_id,
        parent_phone,
        parent_address,
        parent_email,
        parent_phone_alt,
        email,
        phone,
        address,
        status
    } = req.body;

    let passport_photo_path = req.body.existing_photo && req.body.existing_photo.trim() !== '' ? req.body.existing_photo : null;
    if (req.file) {
        passport_photo_path = `/uploads/${req.file.filename}`;
    }

    try {
        const allSections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY id ASC',
            [schoolId]
        );

        let primary_class_id = current_class_id || null;
        const activeSession = await getCurrentSession(schoolId);
        let updatedAnySection = false;

        for (const sec of allSections) {
            const chosenClassId = req.body[`section_${sec.id}_class_id`] ||
                                  (sec.name === 'Academy' ? req.body.academy_class_id : null) ||
                                  (sec.name === 'Tahfeez' ? req.body.tahfeez_class_id : null) || null;

            if (chosenClassId) {
                updatedAnySection = true;
                if (!primary_class_id) primary_class_id = chosenClassId;
            }

            const ctx = await getSectionContext(sec.id, schoolId);
            const sessionToUse = (ctx && ctx.session) || activeSession;
            if (sessionToUse) {
                // Remove existing enrollment for this section and session
                await db.run(`
                    DELETE FROM student_enrollments 
                    WHERE student_id = ? 
                      AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?) 
                      AND session = ?
                `, [id, sec.id, schoolId, sessionToUse]);

                // Re-enroll if a class was chosen
                if (chosenClassId) {
                    await db.run(
                        "INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)",
                        [id, chosenClassId, sessionToUse]
                    );
                }
            }
        }

        // Fallback for single class selection when section-specific fields were not sent
        if (!updatedAnySection && primary_class_id) {
            const classRow = await db.get(
                'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
                [primary_class_id, schoolId]
            );
            if (classRow) {
                const ctx = await getSectionContext(classRow.section_id, schoolId);
                const sessionToUse = (ctx && ctx.session) || activeSession;
                if (sessionToUse) {
                    await db.run(`
                        DELETE FROM student_enrollments 
                        WHERE student_id = ? 
                          AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?) 
                          AND session = ?
                    `, [id, classRow.section_id, schoolId, sessionToUse]);

                    await db.run(
                        "INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)",
                        [id, classRow.id, sessionToUse]
                    );
                }
            }
        }

        const sql = `
            UPDATE students SET
                first_name = ?, last_name = ?, gender = ?, dob = ?, 
                admission_number = ?, current_class_id = ?, 
                parent_phone = ?, parent_address = ?, parent_email = ?, parent_phone_alt = ?,
                email = ?, phone = ?, address = ?, passport_photo_path = ?, status = ?
            WHERE id = ? AND school_id = ?
        `;

        await db.run(sql, [
            first_name, last_name, gender, dob,
            admission_number || null,
            primary_class_id,
            parent_phone || null,
            parent_address || null,
            parent_email || null,
            parent_phone_alt || null,
            email || null,
            phone || null,
            address || null,
            passport_photo_path,
            status,
            id,
            schoolId
        ]);

        res.json({ success: true, message: 'Student updated successfully.' });

        logAction(req.session.staff.id, 'UPDATE_STUDENT', 'STUDENT', {
            id, first_name, last_name, admission_number
        }, req.ip);
    } catch (err) {
        console.error('Update Student Error:', err);
        res.status(500).json({ success: false, message: 'Failed to update student.' });
    }
};

const saveHealthRecord = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const {
        student_id, blood_group, genotype, allergies,
        medical_conditions, emergency_contact_name, emergency_contact_phone
    } = req.body;

    try {
        const student = await db.get(
            'SELECT id FROM students WHERE id = ? AND school_id = ?',
            [student_id, schoolId]
        );
        if (!student) {
            return res.status(404).send('Student not found or access denied');
        }

        const sql = `
            INSERT INTO student_health (
                student_id, blood_group, genotype, allergies, 
                medical_conditions, emergency_contact_name, emergency_contact_phone
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id) DO UPDATE SET
                blood_group = excluded.blood_group,
                genotype = excluded.genotype,
                allergies = excluded.allergies,
                medical_conditions = excluded.medical_conditions,
                emergency_contact_name = excluded.emergency_contact_name,
                emergency_contact_phone = excluded.emergency_contact_phone
        `;

        await db.run(sql, [
            student_id, blood_group, genotype, allergies,
            medical_conditions, emergency_contact_name, emergency_contact_phone
        ]);

        res.redirect(`/students/view/${student_id}?success=Health record updated`);

        logAction(req.session.staff.id, 'UPDATE_HEALTH', 'HEALTH', {
            student_id
        }, req.ip);
    } catch (err) {
        console.error('Save Health Record Error:', err);
        res.status(500).send('Database Error');
    }
};


const deleteStudent = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    try {
        const student = await db.get(
            'SELECT id FROM students WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        await db.run('DELETE FROM attendance WHERE student_id = ?', [id]);
        await db.run('DELETE FROM results WHERE student_id = ?', [id]);
        await db.run('DELETE FROM payments WHERE student_id = ?', [id]);
        await db.run('DELETE FROM student_fees WHERE student_id = ?', [id]);
        await db.run('DELETE FROM affective_psychomotor WHERE student_id = ?', [id]);
        await db.run('DELETE FROM class_posts WHERE student_id = ?', [id]);
        await db.run('DELETE FROM student_health WHERE student_id = ?', [id]);
        await db.run('DELETE FROM student_enrollments WHERE student_id = ?', [id]);
        await db.run('DELETE FROM notification_reads WHERE user_id = ? AND user_type = ?', [id, 'student']);
        await db.run('DELETE FROM students WHERE id = ? AND school_id = ?', [id, schoolId]);

        logAction(req.session.staff.id, 'DELETE_STUDENT', 'STUDENT', { id }, req.ip);

        res.json({ success: true, message: 'Student deleted successfully.' });
    } catch (err) {
        console.error('Delete Student Error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete student.' });
    }
};

const resetStudentPassword = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    try {
        const student = await db.get(
            'SELECT admission_number FROM students WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        
        const defaultPassword = student.admission_number;
        if (!defaultPassword) {
            return res.status(400).json({ success: false, message: 'Cannot reset password: Student does not have an Admission Number/ID yet.' });
        }

        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        await db.run(
            'UPDATE students SET password = ? WHERE id = ? AND school_id = ?',
            [hashedPassword, id, schoolId]
        );

        logAction(req.session.staff.id, 'RESET_STUDENT_PASSWORD', 'STUDENT', { id, admission_number: defaultPassword }, req.ip);

        res.json({ success: true, message: 'Student password has been reset to their Admission Number successfully.' });
    } catch (err) {
        console.error('Reset Student Password Error:', err);
        res.status(500).json({ success: false, message: 'Failed to reset student password.' });
    }
};

module.exports = {
    enrollStudent, getStudents, getEnrollmentForm,
    getStudentProfile, getEditForm, updateStudent, saveHealthRecord, deleteStudent, resetStudentPassword
};

