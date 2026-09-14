const db = require('../utils/db');

const getAcademicDashboard = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const sections = await db.all(
            'SELECT * FROM sections WHERE school_id = ? ORDER BY name',
            [schoolId]
        );
        const classes = await db.all(
            'SELECT c.*, s.name as section_name FROM classes c LEFT JOIN sections s ON c.section_id = s.id WHERE c.school_id = ? ORDER BY s.name, c.name',
            [schoolId]
        );
        const subjects = await db.all(
            'SELECT * FROM subjects WHERE school_id = ? ORDER BY name',
            [schoolId]
        );
        const teachers = await db.all(
            "SELECT id, first_name, last_name, staff_id FROM staff WHERE status != 'inactive' AND school_id = ? ORDER BY last_name",
            [schoolId]
        );
        const assignments = await db.all(`
            SELECT sa.*, t.first_name, t.last_name, s.name as subject_name, c.name as class_name
            FROM subject_assignments sa
            JOIN staff t ON sa.teacher_id = t.id
            JOIN subjects s ON sa.subject_id = s.id
            JOIN classes c ON sa.class_id = c.id
            WHERE c.school_id = ?
            ORDER BY sa.session DESC, t.first_name, t.last_name
        `, [schoolId]);

        res.render('academics/index', {
            title: 'Academic Management',
            sections,
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { name, section_id } = req.body;
    try {
        await db.run(
            'INSERT INTO classes (school_id, name, section_id) VALUES (?, ?, ?)',
            [schoolId, name, section_id || null]
        );
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Class Error:', err);
        res.status(500).send('Error adding class');
    }
};

const updateClass = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    const { name, section_id } = req.body;
    try {
        const clazz = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [id, schoolId]);
        if (!clazz) {
            return res.status(404).send('Class not found');
        }

        let validatedSectionId = null;
        if (section_id && String(section_id).trim() !== '') {
            const sec = await db.get('SELECT id FROM sections WHERE id = ? AND school_id = ?', [section_id, schoolId]);
            if (sec) {
                validatedSectionId = sec.id;
            }
        }

        await db.run(
            'UPDATE classes SET name = ?, section_id = ? WHERE id = ? AND school_id = ?',
            [name.trim(), validatedSectionId, id, schoolId]
        );
        res.redirect('/academics');
    } catch (err) {
        console.error('Update Class Error:', err);
        res.status(500).send('Error updating class');
    }
};

const deleteClass = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    try {
        const clazz = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [id, schoolId]);
        if (!clazz) {
            return res.status(404).send('Class not found');
        }

        await db.transaction(async () => {
            await db.run(`
                UPDATE students 
                SET current_arm_id = NULL 
                WHERE current_arm_id IN (SELECT id FROM arms WHERE class_id = ?)
            `, [id]);
            
            await db.run('UPDATE students SET current_class_id = NULL WHERE current_class_id = ?', [id]);
            await db.run('DELETE FROM student_enrollments WHERE class_id = ?', [id]);
            await db.run('DELETE FROM class_assignments WHERE class_id = ?', [id]);
            await db.run('DELETE FROM subject_assignments WHERE class_id = ?', [id]);
            await db.run('DELETE FROM class_posts WHERE class_id = ?', [id]);
            await db.run('DELETE FROM attendance WHERE class_id = ?', [id]);

            const feeCats = await db.all('SELECT id FROM fee_categories WHERE class_id = ? AND school_id = ?', [id, schoolId]);
            for (const fc of feeCats) {
                await db.run(`
                    DELETE FROM payments 
                    WHERE student_fee_id IN (SELECT id FROM student_fees WHERE fee_category_id = ?)
                `, [fc.id]);
                
                await db.run('DELETE FROM student_fees WHERE fee_category_id = ?', [fc.id]);
                await db.run('DELETE FROM fee_categories WHERE id = ? AND school_id = ?', [fc.id, schoolId]);
            }

            await db.run('DELETE FROM arms WHERE class_id = ?', [id]);
            await db.run('DELETE FROM classes WHERE id = ? AND school_id = ?', [id, schoolId]);
        });

        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Class Error:', err);
        res.status(500).send('Error deleting class: ' + err.message);
    }
};

// Subject Management
const addSubject = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { name, code } = req.body;
    try {
        await db.run(
            'INSERT INTO subjects (school_id, name, code) VALUES (?, ?, ?)',
            [schoolId, name, code]
        );
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Subject Error:', err);
        res.status(500).send('Error adding subject');
    }
};

const editSubjectForm = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    try {
        const subject = await db.get(
            'SELECT * FROM subjects WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    const { name, code } = req.body;
    try {
        await db.run(
            'UPDATE subjects SET name = ?, code = ? WHERE id = ? AND school_id = ?',
            [name, code, id, schoolId]
        );
        res.redirect('/academics');
    } catch (err) {
        console.error('Update Subject Error:', err);
        res.status(500).send('Error updating subject');
    }
};

const deleteSubject = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { id } = req.params;
    try {
        await db.run(
            'DELETE FROM subjects WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Subject Error:', err);
        res.status(500).send('Error deleting subject');
    }
};

// Subject Assignment Management ΓÇô tenant-verified before insert
const addAssignment = async (req, res) => {
    const { teacher_id, subject_id, class_id, session } = req.body;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        // Verify all entities belong to the tenant
        const teacher = await db.get('SELECT id FROM staff WHERE id = ? AND school_id = ?', [teacher_id, schoolId]);
        const subject = await db.get('SELECT id FROM subjects WHERE id = ? AND school_id = ?', [subject_id, schoolId]);
        const klass  = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!teacher || !subject || !klass) {
            return res.status(403).send('Error: One or more entities do not belong to this school.');
        }
        await db.run(`
            INSERT INTO subject_assignments (teacher_id, subject_id, class_id, session)
            VALUES (?, ?, ?, ?)
        `, [teacher_id, subject_id, class_id, session]);
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Assignment Error:', err);
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err.message && err.message.includes('unique'))) {
            return res.status(400).send('Error: This assignment already exists.');
        }
        res.status(500).send('Error assigning teacher');
    }
};

const deleteAssignment = async (req, res) => {
    const { id } = req.params;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        // Verify assignment belongs to tenant before deleting
        const assign = await db.get(`
            SELECT sa.id FROM subject_assignments sa
            JOIN classes c ON sa.class_id = c.id
            WHERE sa.id = ? AND c.school_id = ?
        `, [id, schoolId]);
        if (!assign) return res.status(404).send('Assignment not found or tenant mismatch');
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
    updateClass,
    deleteClass,
    addSubject,
    editSubjectForm,
    updateSubject,
    deleteSubject,
    addAssignment,
    deleteAssignment
};


