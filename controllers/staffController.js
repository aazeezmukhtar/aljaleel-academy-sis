const db = require('../utils/db');
const bcrypt = require('bcryptjs');

// GET /staff - Show all staff members
const getAllStaff = async (req, res) => {
    try {
        const staff = await db.all('SELECT * FROM staff ORDER BY last_name, first_name');
        res.render('staff/index', { title: 'Staff Directory', staff });
    } catch (err) {
        console.error('getAllStaff Error:', err);
        res.status(500).send('Database Error');
    }
};

// GET /staff/add - Show add staff form
const addStaffForm = (req, res) => {
    res.render('staff/add', { title: 'Register New Staff' });
};

// POST /staff/add - Save new staff member
const saveStaff = async (req, res) => {
    const { first_name, last_name, staff_id, role, designation, public_bio, show_on_website } = req.body;
    const avatar_image = req.file ? req.file.filename : null;
    const defaultPassword = bcrypt.hashSync(`${staff_id}123`, 10);

    try {
        await db.run(`
            INSERT INTO staff (first_name, last_name, staff_id, role, designation, password_hash, avatar_image, public_bio, show_on_website, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `, [first_name, last_name, staff_id.toLowerCase(), role, designation, defaultPassword, avatar_image, public_bio || null, show_on_website ? 1 : 0]);

        res.redirect('/staff');
    } catch (err) {
        console.error('saveStaff Error:', err);
        // Likely a duplicate staff_id
        res.redirect('/staff/add?error=Staff ID already exists. Please choose a unique ID.');
    }
};

// GET /staff/view/:id - View staff profile and assignments
const getStaffProfile = async (req, res) => {
    const { id } = req.params;
    const user = req.session.staff;

    try {
        const member = await db.get('SELECT * FROM staff WHERE id = ?', [id]);
        if (!member) return res.status(404).send('Staff member not found');

        const classAssignments = await db.all(`
            SELECT ca.id, ca.session, c.name as class_name
            FROM class_assignments ca
            JOIN classes c ON ca.class_id = c.id
            WHERE ca.staff_id = ?
            ORDER BY ca.session DESC, c.name
        `, [id]);

        const subjectAssignments = await db.all(`
            SELECT sa.id, sa.session, s.name as subject_name, c.name as class_name
            FROM subject_assignments sa
            JOIN subjects s ON sa.subject_id = s.id
            JOIN classes c ON sa.class_id = c.id
            WHERE sa.teacher_id = ?
            ORDER BY sa.session DESC, s.name
        `, [id]);

        const allClasses = await db.all('SELECT * FROM classes ORDER BY name');
        const allSubjects = await db.all('SELECT * FROM subjects ORDER BY name');

        res.render('staff/view', {
            title: `${member.first_name} ${member.last_name}`,
            member,
            user,
            classAssignments,
            subjectAssignments,
            allClasses,
            allSubjects
        });
    } catch (err) {
        console.error('getStaffProfile Error:', err);
        res.status(500).send('Database Error');
    }
};

// GET /staff/edit/:id - Show edit form
const getEditForm = async (req, res) => {
    const { id } = req.params;
    try {
        const member = await db.get('SELECT * FROM staff WHERE id = ?', [id]);
        if (!member) return res.status(404).send('Staff member not found');
        res.render('staff/edit', { title: 'Edit Staff', member });
    } catch (err) {
        console.error('getEditForm Error:', err);
        res.status(500).send('Database Error');
    }
};

// POST /staff/update/:id - Update staff info
const updateStaff = async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, staff_id, role, designation, status, public_bio, show_on_website } = req.body;
    const avatar_image = req.file ? req.file.filename : null;

    try {
        if (avatar_image) {
            await db.run(`
                UPDATE staff SET first_name=?, last_name=?, staff_id=?, role=?, designation=?, status=?,
                public_bio=?, show_on_website=?, avatar_image=? WHERE id=?
            `, [first_name, last_name, staff_id, role, designation, status, public_bio || null, show_on_website ? 1 : 0, avatar_image, id]);
        } else {
            await db.run(`
                UPDATE staff SET first_name=?, last_name=?, staff_id=?, role=?, designation=?, status=?,
                public_bio=?, show_on_website=? WHERE id=?
            `, [first_name, last_name, staff_id, role, designation, status, public_bio || null, show_on_website ? 1 : 0, id]);
        }
        res.redirect(`/staff/view/${id}`);
    } catch (err) {
        console.error('updateStaff Error:', err);
        res.redirect(`/staff/edit/${id}?error=Update failed. Staff ID may already be taken.`);
    }
};

// POST /staff/assign-class - Assign a class to a staff member
const assignClass = async (req, res) => {
    const { staff_id, class_id, session } = req.body;
    try {
        await db.run(`
            INSERT INTO class_assignments (staff_id, class_id, session) VALUES (?, ?, ?)
            ON CONFLICT DO NOTHING
        `, [staff_id, class_id, session]);
        res.redirect(`/staff/view/${staff_id}`);
    } catch (err) {
        console.error('assignClass Error:', err);
        res.redirect(`/staff/view/${staff_id}?error=Assignment failed`);
    }
};

// POST /staff/assign-subject - Assign a subject to a teacher
const assignSubject = async (req, res) => {
    const { staff_id, subject_id, class_id, session } = req.body;
    try {
        await db.run(`
            INSERT INTO subject_assignments (teacher_id, subject_id, class_id, session) VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING
        `, [staff_id, subject_id, class_id, session]);
        res.redirect(`/staff/view/${staff_id}`);
    } catch (err) {
        console.error('assignSubject Error:', err);
        res.redirect(`/staff/view/${staff_id}?error=Assignment failed`);
    }
};

// POST /staff/delete-assignment/:id - Remove a class or subject assignment
const deleteAssignment = async (req, res) => {
    const { id } = req.params;
    const { type, staff_id } = req.query;
    try {
        if (type === 'subject') {
            await db.run('DELETE FROM subject_assignments WHERE id = ?', [id]);
        } else {
            await db.run('DELETE FROM class_assignments WHERE id = ?', [id]);
        }
        res.redirect(`/staff/view/${staff_id}`);
    } catch (err) {
        console.error('deleteAssignment Error:', err);
        res.redirect(`/staff/view/${staff_id}?error=Failed to remove assignment`);
    }
};

// POST /staff/delete/:id - Permanently delete a staff member
const deleteStaff = async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM class_assignments WHERE staff_id = ?', [id]);
        await db.run('DELETE FROM subject_assignments WHERE teacher_id = ?', [id]);
        await db.run('DELETE FROM staff WHERE id = ?', [id]);
        res.json({ success: true, message: 'Staff member deleted successfully.' });
    } catch (err) {
        console.error('deleteStaff Error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete staff member.' });
    }
};

// GET /staff/board - Class board for teachers
const getClassBoard = async (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session } = req.query;

    try {
        let classes;
        if (user.role === 'Admin') {
            classes = await db.all('SELECT * FROM classes ORDER BY name ASC');
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

        const subjects = await db.all(`
            SELECT DISTINCT s.id, s.name 
            FROM subjects s
            JOIN subject_assignments sa ON s.id = sa.subject_id
            WHERE sa.teacher_id = ?
        `, [user.id]);

        const students = await db.all(`SELECT id, first_name, last_name, current_class_id as class_id FROM students WHERE status = 'active'`);

        const posts = classes.length > 0 ? await db.all(`
            SELECT cp.*, c.name as class_name, s.name as subject_name,
                   st.first_name as student_fname, st.last_name as student_lname
            FROM class_posts cp 
            JOIN classes c ON cp.class_id = c.id
            LEFT JOIN subjects s ON cp.subject_id = s.id
            LEFT JOIN students st ON cp.student_id = st.id
            WHERE cp.teacher_id = ?
            ORDER BY cp.created_at DESC
        `, [user.id]) : [];

        res.render('staff/board', {
            title: 'Class Board',
            staff: user,
            classes,
            subjects,
            students,
            posts,
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error('getClassBoard Error:', err);
        res.redirect('/dashboard?error=Server Error');
    }
};

const postClassBoard = async (req, res) => {
    const user = req.session.staff;
    const { class_id, subject_id, student_id, post_type, title, due_date, content } = req.body;
    const attachment = req.file ? req.file.filename : null;
    try {
        await db.run('INSERT INTO class_posts (class_id, teacher_id, subject_id, student_id, post_type, title, content, due_date, attachment_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 
            [class_id, user.id, subject_id || null, student_id || null, post_type, title, content, due_date || null, attachment]);
        res.redirect('/staff/board?success=Post added successfully');
    } catch (err) {
        console.error('postClassBoard Error:', err);
        res.redirect('/staff/board?error=Failed to add post');
    }
};

// POST /staff/board/post/delete/:id - Delete a class board post
const deleteClassBoardPost = async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM class_posts WHERE id = ?', [id]);
        res.redirect('/staff/board?success=Post deleted successfully');
    } catch (err) {
        res.redirect('/staff/board?error=Failed to delete post');
    }
};

module.exports = { getAllStaff, addStaffForm, saveStaff, getStaffProfile, getEditForm, updateStaff, assignClass, assignSubject, deleteAssignment, deleteStaff, getClassBoard, postClassBoard, deleteClassBoardPost };
