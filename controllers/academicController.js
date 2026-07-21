const db = require('../utils/db');

const getAcademicDashboard = async (req, res) => {
    try {
<<<<<<< HEAD
        const classes = await db.all('SELECT * FROM classes');
=======
        const sections = await db.all('SELECT * FROM sections ORDER BY name');
        const classes = await db.all('SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id ORDER BY s.name, c.name');
>>>>>>> local-master
        const subjects = await db.all('SELECT * FROM subjects');
        const teachers = await db.all("SELECT id, first_name, last_name, staff_id FROM staff WHERE status != 'inactive' ORDER BY last_name");
        const assignments = await db.all(`
            SELECT sa.*, t.first_name, t.last_name, s.name as subject_name, c.name as class_name
            FROM subject_assignments sa
            JOIN staff t ON sa.teacher_id = t.id
            JOIN subjects s ON sa.subject_id = s.id
            JOIN classes c ON sa.class_id = c.id
            ORDER BY sa.session DESC, t.first_name, t.last_name
        `);

        res.render('academics/index', {
            title: 'Academic Management',
<<<<<<< HEAD
=======
            sections,
>>>>>>> local-master
            classes,
            subjects,
            teachers,
            assignments
        });
    } catch (err) {
        console.error('Academic Dashboard Error:', err);
        res.status(500).send('DEBUG_ERROR_TRACE: ' + err.message + ' | Stack: ' + err.stack);
    }
};

// Class Management
const addClass = async (req, res) => {
<<<<<<< HEAD
    const { name } = req.body;
    try {
        await db.run('INSERT INTO classes (name) VALUES (?)', [name]);
=======
    const { name, section_id } = req.body;
    try {
        await db.run('INSERT INTO classes (name, section_id) VALUES (?, ?)', [name, section_id || null]);
>>>>>>> local-master
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Class Error:', err);
        res.status(500).send('Error adding class');
    }
};

const deleteClass = async (req, res) => {
    const { id } = req.params;
    try {
        await db.transaction(async () => {
            await db.run(`
                UPDATE students 
                SET current_arm_id = NULL 
                WHERE current_arm_id IN (SELECT id FROM arms WHERE class_id = ?)
            `, [id]);
            
            await db.run('UPDATE students SET current_class_id = NULL WHERE current_class_id = ?', [id]);
<<<<<<< HEAD
=======
            await db.run('DELETE FROM student_enrollments WHERE class_id = ?', [id]);
>>>>>>> local-master
            await db.run('DELETE FROM class_assignments WHERE class_id = ?', [id]);
            await db.run('DELETE FROM subject_assignments WHERE class_id = ?', [id]);
            await db.run('DELETE FROM class_posts WHERE class_id = ?', [id]);
            await db.run('DELETE FROM attendance WHERE class_id = ?', [id]);

            const feeCats = await db.all('SELECT id FROM fee_categories WHERE class_id = ?', [id]);
            for (const fc of feeCats) {
                await db.run(`
                    DELETE FROM payments 
                    WHERE student_fee_id IN (SELECT id FROM student_fees WHERE fee_category_id = ?)
                `, [fc.id]);
                
                await db.run('DELETE FROM student_fees WHERE fee_category_id = ?', [fc.id]);
                await db.run('DELETE FROM fee_categories WHERE id = ?', [fc.id]);
            }

            await db.run('DELETE FROM arms WHERE class_id = ?', [id]);
            await db.run('DELETE FROM classes WHERE id = ?', [id]);
        });

        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Class Error:', err);
        res.status(500).send('Error deleting class: ' + err.message);
    }
};

// Subject Management
const addSubject = async (req, res) => {
    const { name, code } = req.body;
    try {
        await db.run('INSERT INTO subjects (name, code) VALUES (?, ?)', [name, code]);
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Subject Error:', err);
        res.status(500).send('Error adding subject');
    }
};

const editSubjectForm = async (req, res) => {
    const { id } = req.params;
    try {
        const subject = await db.get('SELECT * FROM subjects WHERE id = ?', [id]);
        if (!subject) return res.status(404).send('Subject not found');
        res.render('academics/edit-subject', {
            title: 'Edit Subject',
            subject
        });
    } catch (err) {
        console.error('Edit Subject Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const updateSubject = async (req, res) => {
    const { id } = req.params;
    const { name, code } = req.body;
    try {
        await db.run('UPDATE subjects SET name = ?, code = ? WHERE id = ?', [name, code, id]);
        res.redirect('/academics');
    } catch (err) {
        console.error('Update Subject Error:', err);
        res.status(500).send('Error updating subject');
    }
};

const deleteSubject = async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM subjects WHERE id = ?', [id]);
        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Subject Error:', err);
        res.status(500).send('Error deleting subject');
    }
};

// Subject Assignment Management
const addAssignment = async (req, res) => {
    const { teacher_id, subject_id, class_id, session } = req.body;
    try {
        await db.run(`
            INSERT INTO subject_assignments (teacher_id, subject_id, class_id, session)
            VALUES (?, ?, ?, ?)
        `, [teacher_id, subject_id, class_id, session]);
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Assignment Error:', err);
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message.includes('unique')) {
            return res.status(400).send('Error: This assignment already exists.');
        }
        res.status(500).send('Error assigning teacher');
    }
};

const deleteAssignment = async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM subject_assignments WHERE id = ?', [id]);
        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Assignment Error:', err);
        res.status(500).send('Error deleting assignment');
    }
};


module.exports = {
    getAcademicDashboard,
    addClass,
    deleteClass,
    addSubject,
    editSubjectForm,
    updateSubject,
    deleteSubject,
    addAssignment,
    deleteAssignment
};
