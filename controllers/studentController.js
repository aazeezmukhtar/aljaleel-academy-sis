const db = require('../utils/db');
const { getAcademicContext, getSectionContext, getCurrentSession, getCurrentTerm } = require('../utils/sessionHelper');
const { logAction } = require('../utils/logger');
const { generateUniqueID } = require('../utils/idHelper');
const bcrypt = require('bcryptjs');
const { uploadFile } = require('../utils/storageHelper');

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

    // Fetch current session from settings or fallback
    const sessionSettingRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'").catch(() => null);
    const activeCurrentSession = (sessionSettingRow && sessionSettingRow.value) || '2025/2026';

    let query = `
        SELECT s.*, c.name as class_name, c.section_id as class_section_id, se.class_id as enrolled_class_id
        FROM students s
        LEFT JOIN student_enrollments se ON s.id = se.student_id AND (
            se.session = (
                SELECT sec.current_session 
                FROM sections sec 
                JOIN classes cl ON cl.section_id = sec.id 
                WHERE cl.id = se.class_id
            )
            OR se.session = ?
        )
        LEFT JOIN classes c ON (se.class_id = c.id OR s.current_class_id = c.id)
        WHERE 1=1
    `;
    const params = [activeCurrentSession];

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

        const currentSession = (await getCurrentSession(schoolId)) || '2025/2026';
        const currentTerm = (await getCurrentTerm(schoolId)) || '1st Term';

        res.render('students/enroll', {
            title: 'Enroll New Student',
            classes,
            sections,
            currentSession,
            currentTerm
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
        first_name, last_name, gender, dob, current_class_id,
        phone, email, address, parent_phone, parent_address,
        parent_email, parent_phone_alt
    } = req.body;

    try {
        const allSections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY id ASC',
            [schoolId]
        );
        const schoolClasses = await db.all(
            'SELECT id, section_id FROM classes WHERE school_id = ?',
            [schoolId]
        );

        const classById = new Map(schoolClasses.map(cls => [Number(cls.id), cls]));
        const sectionIds = new Set(allSections.map(section => Number(section.id)));
        const assignments = [];
        const hasSectionSelectors = Object.keys(req.body || {}).some(field => /^section_\d+_class_id$/.test(field));

        // Validate the legacy class field too, if supplied, even when section
        // selectors are present. Never silently ignore a contradictory value.
        let legacyClass = null;
        if (current_class_id !== undefined && current_class_id !== null && String(current_class_id).trim() !== '') {
            const legacyId = Number(current_class_id);
            if (!Number.isInteger(legacyId) || legacyId <= 0 || !classById.has(legacyId)) {
                return res.redirect('/students/enroll?error=Invalid class assignment');
            }
            legacyClass = classById.get(legacyId);
        }

        // Reject unknown sections, invalid class IDs, and classes assigned to
        // a different section before generating uploads or writing student data.
        for (const [field, rawValue] of Object.entries(req.body || {})) {
            const sectionField = field.match(/^section_(\d+)_class_id$/);
            if (!sectionField || rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;
            const sectionId = Number(sectionField[1]);
            const classId = Number(rawValue);
            if (!sectionIds.has(sectionId) || !Number.isInteger(classId) || classId <= 0) {
                return res.redirect('/students/enroll?error=Invalid class assignment');
            }
            const cls = classById.get(classId);
            if (!cls || Number(cls.section_id) !== sectionId) {
                return res.redirect('/students/enroll?error=Invalid class assignment');
            }
            assignments.push({ sectionId, classId: cls.id });
        }

        // Backward-compatible single-class form is used only when this form
        // did not submit section selectors at all (blank selectors mean "skip").
        if (!hasSectionSelectors && assignments.length === 0 && legacyClass) {
            assignments.push({ sectionId: legacyClass.section_id || null, classId: legacyClass.id });
        } else if (hasSectionSelectors && legacyClass &&
                   assignments.length > 0 &&
                   !assignments.some(item => Number(item.classId) === Number(legacyClass.id))) {
            return res.redirect('/students/enroll?error=Conflicting class assignments');
        }

        // Resolve and validate academic context before beginning any writes.
        const assignmentPlans = [];
        for (const assignment of assignments) {
            const context = await getAcademicContext(assignment.classId, schoolId);
            const session = context && context.session;
            const term = context && context.term;
            if (!session || !term) {
                throw new Error('Academic session or term is not configured for the selected class.');
            }
            assignmentPlans.push({ ...assignment, session, term });
        }

        const admission_number = await generateUniqueID();
        const passport_photo_path = req.file ? await uploadFile(req.file, 'students') : null;
        const hashedPassword = await bcrypt.hash(admission_number, 10);
        const sql = `
            INSERT INTO students (
                school_id, first_name, last_name, gender, dob, current_class_id,
                phone, email, address, parent_phone, parent_address, parent_email, parent_phone_alt,
                admission_number, passport_photo_path, password, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `;
        const primaryClassId = assignmentPlans.length ? assignmentPlans[0].classId : null;
        const studentParams = [
            schoolId, first_name, last_name, gender, dob || null, primaryClassId,
            phone || null, email || null, address || null,
            parent_phone || null, parent_address || null, parent_email || null, parent_phone_alt || null,
            admission_number, passport_photo_path, hashedPassword
        ];

        await db.transaction(async (client = null) => {
            await db.run(sql, studentParams, client);
            const studentRow = await db.get(
                'SELECT id FROM students WHERE admission_number = ? AND school_id = ?',
                [admission_number, schoolId],
                client
            );
            if (!studentRow) throw new Error('Student record could not be verified after insertion.');

            for (const plan of assignmentPlans) {
                await db.run(
                    'INSERT INTO student_enrollments (student_id, class_id, session, term) VALUES (?, ?, ?, ?)',
                    [studentRow.id, plan.classId, plan.session, plan.term],
                    client
                );
            }
        });

        logAction(req.session.staff.id, 'ENROLL_STUDENT', 'STUDENT', { first_name, last_name }, req.ip);
        return res.redirect('/students?success=true');
    } catch (err) {
        console.error('Enroll Error:', err);
        return res.redirect('/students/enroll?error=Enrollment failed');
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

        const sessionSettingRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'").catch(() => null);
        const activeCurrentSession = (sessionSettingRow && sessionSettingRow.value) || '2025/2026';

        const enrollments = await db.all(`
            SELECT c.name as class_name
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            LEFT JOIN sections sec ON c.section_id = sec.id
            WHERE se.student_id = ? AND (se.session = sec.current_session OR se.session = ?)
        `, [id, activeCurrentSession]);

        student.class_name = enrollments.map(e => e.class_name).join(', ') || student.class_name || 'Not Enrolled';

        const feeRow = await db.get(`
            SELECT COALESCE(SUM(total_amount), 0) as total_owed, COALESCE(SUM(paid_amount), 0) as total_paid
            FROM student_fees WHERE student_id = ?
        `, [id]);
        const fees = feeRow || { total_owed: 0, total_paid: 0 };

        const health = await db.get('SELECT * FROM student_health WHERE student_id = ?', [id]) || {};

        const academicTerms = await db.all(`
            SELECT DISTINCT r.class_id, c.name AS class_name, r.term, r.session
            FROM results r
            LEFT JOIN classes c ON c.id = r.class_id
            WHERE r.student_id = ?
            ORDER BY r.session DESC, c.name, r.term ASC
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
        
        const sessionSettingRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'").catch(() => null);
        const activeCurrentSession = (sessionSettingRow && sessionSettingRow.value) || '2025/2026';

        const enrollments = await db.all(`
            SELECT se.class_id 
            FROM student_enrollments se
            JOIN classes c ON se.class_id = c.id
            LEFT JOIN sections sec ON c.section_id = sec.id
            WHERE se.student_id = ? AND (se.session = sec.current_session OR se.session = ?)
        `, [id, activeCurrentSession]);
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
        passport_photo_path = await uploadFile(req.file, 'students');
    }

    try {
        const allSections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY id ASC',
            [schoolId]
        );
        const schoolClasses = await db.all(
            'SELECT id, section_id FROM classes WHERE school_id = ?',
            [schoolId]
        );

        // Validate all submitted class choices before changing any enrollment.
        const validateClass = (rawId, expectedSectionId = null) => {
            if (rawId === undefined || rawId === null || String(rawId).trim() === '') return null;
            const parsedId = Number(rawId);
            if (!Number.isInteger(parsedId) || parsedId <= 0) return false;
            const match = schoolClasses.find(c => Number(c.id) === parsedId);
            if (!match) return false;
            if (expectedSectionId !== null && Number(match.section_id) !== Number(expectedSectionId)) return false;
            return match.id;
        };

        if (current_class_id && !validateClass(current_class_id)) {
            return res.status(400).json({ success: false, message: 'Invalid class assignment.' });
        }
        for (const sec of allSections) {
            const rawClassId = req.body[`section_${sec.id}_class_id`] ||
                               (sec.name === 'Academy' ? req.body.academy_class_id : null) ||
                               (sec.name === 'Tahfeez' ? req.body.tahfeez_class_id : null) || null;
            if (rawClassId && !validateClass(rawClassId, sec.id)) {
                return res.status(400).json({
                    success: false,
                    message: 'The selected class does not belong to the chosen section.'
                });
            }
        }

        let primary_class_id = current_class_id ? validateClass(current_class_id) : null;
        const activeSession = await getCurrentSession(schoolId);
        let updatedAnySection = false;
        const sectionPlans = [];

        // Resolve each section's session and term before performing any writes.
        for (const sec of allSections) {
            const rawClassId = req.body[`section_${sec.id}_class_id`] ||
                               (sec.name === 'Academy' ? req.body.academy_class_id : null) ||
                               (sec.name === 'Tahfeez' ? req.body.tahfeez_class_id : null) || null;
            const chosenClassId = rawClassId ? validateClass(rawClassId, sec.id) : null;

            if (chosenClassId) {
                updatedAnySection = true;
                if (!primary_class_id) primary_class_id = chosenClassId;
            }

            const ctx = await getSectionContext(sec.id, schoolId);
            sectionPlans.push({
                sectionId: sec.id,
                chosenClassId,
                session: (ctx && ctx.session) || sec.current_session || activeSession,
                term: (ctx && ctx.term) || sec.current_term || '1st Term'
            });
        }

        // Legacy single-class form used when section assignment fields are absent.
        if (!updatedAnySection && primary_class_id) {
            const classRow = schoolClasses.find(c => Number(c.id) === Number(primary_class_id));
            if (!classRow) {
                return res.status(400).json({ success: false, message: 'Invalid class assignment.' });
            }
            const ctx = await getSectionContext(classRow.section_id, schoolId);
            sectionPlans.push({
                sectionId: classRow.section_id,
                chosenClassId: classRow.id,
                session: (ctx && ctx.session) || activeSession,
                term: (ctx && ctx.term) || '1st Term',
                legacySingleClass: true
            });
        }

        const sql = `
            UPDATE students SET
                first_name = ?, last_name = ?, gender = ?, dob = ?,
                admission_number = ?, current_class_id = ?,
                parent_phone = ?, parent_address = ?, parent_email = ?, parent_phone_alt = ?,
                email = ?, phone = ?, address = ?, passport_photo_path = ?, status = ?
            WHERE id = ? AND school_id = ?
        `;
        const studentParams = [
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
        ];

        // Keep enrollment changes and profile updates atomic in both SQLite and
        // PostgreSQL. Every PostgreSQL write uses the same transaction client.
        await db.transaction(async (client = null) => {
            for (const plan of sectionPlans) {
                if (!plan.session) continue;

                if (plan.legacySingleClass && plan.sectionId == null) {
                    await db.run(
                        'DELETE FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?',
                        [id, plan.chosenClassId, plan.session],
                        client
                    );
                } else {
                    await db.run(`
                        DELETE FROM student_enrollments
                        WHERE student_id = ?
                          AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?)
                          AND session = ?
                    `, [id, plan.sectionId, schoolId, plan.session], client);
                }

                if (plan.chosenClassId) {
                    await db.run(
                        `INSERT INTO student_enrollments (student_id, class_id, session, term)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(student_id, class_id, session)
                         DO UPDATE SET term = excluded.term`,
                        [id, plan.chosenClassId, plan.session, plan.term],
                        client
                    );
                }
            }

            await db.run(sql, studentParams, client);
        });

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

