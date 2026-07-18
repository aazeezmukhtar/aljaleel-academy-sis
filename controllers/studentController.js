const db = require('../utils/db');
const { getAcademicContext, getSectionContext } = require('../utils/sessionHelper');
const { logAction } = require('../utils/logger');
const { generateUniqueID } = require('../utils/idHelper');
const bcrypt = require('bcryptjs');

const getStudents = async (req, res) => {
    const user = req.session.staff;
    const { search, class_id, status } = req.query;

    let classes;
    if (user.role === 'Admin' || user.role === 'Registrar') {
        classes = await db.all('SELECT * FROM classes WHERE id != 0');
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

    let query = `
        SELECT s.*, c.name as class_name, se.class_id as enrolled_class_id
        FROM students s
        LEFT JOIN student_enrollments se ON s.id = se.student_id AND se.session = (
            SELECT sec.current_session 
            FROM sections sec 
            JOIN classes cl ON cl.section_id = sec.id 
            WHERE cl.id = se.class_id
        )
        LEFT JOIN classes c ON se.class_id = c.id
        WHERE 1=1
    `;
    const params = [];

    let myClasses = [];
    if (user.role !== 'Admin' && user.role !== 'Registrar') {
        myClasses = classes.map(c => c.id);
        if (myClasses.length > 0) {
            query += ` AND se.class_id IN (${myClasses.join(',')})`;
        } else {
            query += ` AND se.class_id = -1`; // Return none
        }
    }

    if (status) {
        query += ` AND s.status = ?`;
        params.push(status);
        // Apply class filter if provided (overrides or further restricts)
        if (class_id) {
            query += ` AND se.class_id = ?`;
            params.push(class_id);
        }
        // Apply search filter on name or admission number
        if (search) {
            query += ` AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ?)`;
            const like = `%${search}%`;
            params.push(like, like, like);
        }
    }

    query += ` ORDER BY s.first_name ASC, s.last_name ASC`;

    try {
        const rows = await db.all(query, params);

        // Always group by student ID to prevent duplicate listings in directory
        // and to collect all classes for dual class assignments.
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
            s.class_name = s.class_names.length > 0 ? s.class_names.join(', ') : 'Not Enrolled';
            s.enrolled_class_ids = s.class_ids.join(',');
            return s;
        });

        res.render('students/index', {
            title: 'Student Management',
            students,
            classes,
            user,
            filters: { search, class_id: class_id || '', status: status || '' }
        });
    } catch (err) {
        console.error('Fetch Students Error:', err);
        res.status(500).send('Database Error');
    }
};

const getEnrollmentForm = async (req, res) => {
    try {
        const user = req.session.staff;
        let classes;
        if (user.role === 'Admin' || user.role === 'Registrar') {
            classes = await db.all('SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id');
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.*, s.name as section_name 
                FROM classes c
                LEFT JOIN sections s ON c.section_id = s.id
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
                ORDER BY c.name ASC
            `, [user.id, user.id, user.id]);
        }
        res.render('students/enroll', {
            title: 'Enroll New Student',
            classes
        });
    } catch (err) {
        console.error('Fetch Metadata Error:', err);
        res.status(500).send('Database Error');
    }
};

const enrollStudent = async (req, res) => {
    const {
        first_name,
        last_name,
        gender,
        dob,
        academy_class_id,
        tahfeez_class_id,
        parent_phone,
        parent_address
    } = req.body;
    
    const admission_number = await generateUniqueID();
    const passport_photo_path = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const primary_class_id = academy_class_id || tahfeez_class_id || null;
        const hashedPassword = await bcrypt.hash(admission_number, 10);
        const sql = `
            INSERT INTO students (first_name, last_name, gender, dob, current_class_id, parent_phone, parent_address, admission_number, passport_photo_path, password, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `;
        const insertResult = await db.run(sql, [first_name, last_name, gender, dob, primary_class_id, parent_phone, parent_address, admission_number, passport_photo_path, hashedPassword]);
        
        // Postgres returns lastInsertRowid as null, we need to fetch by admission_number
        const studentRow = await db.get("SELECT id FROM students WHERE admission_number = ?", [admission_number]);
        const studentId = studentRow.id;
        
        // Insert Enrollments
        if (academy_class_id) {
            const context = await getAcademicContext(academy_class_id);
            await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)", [studentId, academy_class_id, context.session]);
        }
        if (tahfeez_class_id) {
            const context = await getAcademicContext(tahfeez_class_id);
            await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)", [studentId, tahfeez_class_id, context.session]);
        }
        
        logAction(req.session.staff.id, 'ENROLL_STUDENT', 'STUDENT', { first_name, last_name }, req.ip);
        res.redirect('/students?success=true');
    } catch (err) {
        console.error('Enroll Error:', err);
        res.redirect('/students/enroll?error=Enrollment failed');
    }
};

const getStudentProfile = async (req, res) => {
    const { id } = req.params;
    try {
        const student = await db.get('SELECT * FROM students WHERE id = ?', [id]);
        if (!student) return res.status(404).send('Student not found');

        const enrollments = await db.all(`
            SELECT c.name as class_name
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            JOIN sections sec ON c.section_id = sec.id
            WHERE se.student_id = ? AND se.session = sec.current_session
        `, [id]);

        student.class_name = enrollments.map(e => e.class_name).join(', ') || 'Not Enrolled';

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
    const { id } = req.params;
    const user = req.session.staff;
    try {
        const student = await db.get('SELECT * FROM students WHERE id = ?', [id]);
        
        // Get current session enrollments
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
            classes = await db.all('SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id');
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.*, s.name as section_name 
                FROM classes c
                LEFT JOIN sections s ON c.section_id = s.id
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
                ORDER BY c.name ASC
            `, [user.id, user.id, user.id]);
        }
        res.render('students/edit', {
            title: `Edit Student: ${student.first_name} ${student.last_name}`,
            student,
            classes,
            enrolledClassIds
        });
    } catch (err) {
        console.error('Fetch Edit Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const updateStudent = async (req, res) => {
    const { id } = req.params;
    const {
        first_name,
        last_name,
        gender,
        dob,
        admission_number,
        academy_class_id,
        tahfeez_class_id,
        parent_phone,
        parent_address,
        status
    } = req.body;

    // Preserve existing photo if no new file is uploaded. If the hidden field is empty, keep the current DB value unchanged (null).
    let passport_photo_path = req.body.existing_photo && req.body.existing_photo.trim() !== '' ? req.body.existing_photo : null;
    if (req.file) {
        passport_photo_path = `/uploads/${req.file.filename}`;
    }

    try {
        const primary_class_id = academy_class_id || tahfeez_class_id || null;
        const sql = `
            UPDATE students SET
                first_name = ?, last_name = ?, gender = ?, dob = ?, 
                admission_number = ?, current_class_id = ?, 
                parent_phone = ?, parent_address = ?, passport_photo_path = ?, status = ?
            WHERE id = ?
        `;

        await db.run(sql, [
            first_name, last_name, gender, dob,
            admission_number || null,
            primary_class_id,
            parent_phone || null,
            parent_address || null,
            passport_photo_path,
            status,
            id
        ]);

        // Clear and update enrollments based on section sessions
        const academyCtx = await getSectionContext(1);
        if (academyCtx) {
            await db.run(`
                DELETE FROM student_enrollments 
                WHERE student_id = ? 
                  AND class_id IN (SELECT id FROM classes WHERE section_id = 1) 
                  AND session = ?
            `, [id, academyCtx.session]);
            
            if (academy_class_id) {
                await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)", [id, academy_class_id, academyCtx.session]);
            }
        }

        const tahfeezCtx = await getSectionContext(2);
        if (tahfeezCtx) {
            await db.run(`
                DELETE FROM student_enrollments 
                WHERE student_id = ? 
                  AND class_id IN (SELECT id FROM classes WHERE section_id = 2) 
                  AND session = ?
            `, [id, tahfeezCtx.session]);
            
            if (tahfeez_class_id) {
                await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)", [id, tahfeez_class_id, tahfeezCtx.session]);
            }
        }

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
    const {
        student_id, blood_group, genotype, allergies,
        medical_conditions, emergency_contact_name, emergency_contact_phone
    } = req.body;

    try {
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
    const { id } = req.params;
    try {
        await db.run('DELETE FROM attendance WHERE student_id = ?', [id]);
        await db.run('DELETE FROM results WHERE student_id = ?', [id]);
        await db.run('DELETE FROM payments WHERE student_id = ?', [id]);
        await db.run('DELETE FROM student_fees WHERE student_id = ?', [id]);
        await db.run('DELETE FROM affective_psychomotor WHERE student_id = ?', [id]);
        await db.run('DELETE FROM class_posts WHERE student_id = ?', [id]);
        await db.run('DELETE FROM student_health WHERE student_id = ?', [id]);
        await db.run('DELETE FROM student_enrollments WHERE student_id = ?', [id]);
        await db.run('DELETE FROM notification_reads WHERE user_id = ? AND user_type = ?', [id, 'student']);
        await db.run('DELETE FROM students WHERE id = ?', [id]);

        logAction(req.session.staff.id, 'DELETE_STUDENT', 'STUDENT', { id }, req.ip);

        res.json({ success: true, message: 'Student deleted successfully.' });
    } catch (err) {
        console.error('Delete Student Error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete student.' });
    }
};

const resetStudentPassword = async (req, res) => {
    const { id } = req.params;
    try {
        const student = await db.get('SELECT admission_number FROM students WHERE id = ?', [id]);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        
        const defaultPassword = student.admission_number;
        if (!defaultPassword) {
            return res.status(400).json({ success: false, message: 'Cannot reset password: Student does not have an Admission Number/ID yet.' });
        }

        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        await db.run('UPDATE students SET password = ? WHERE id = ?', [hashedPassword, id]);

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
