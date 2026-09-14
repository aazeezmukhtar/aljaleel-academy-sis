const db = require('../utils/db');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const { computeResult } = require('../utils/resultHelper');
const { getEnrolledStudents } = require('../utils/enrollmentHelper');

const downloadTemplate = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { class_id, subject_id } = req.query;

    if (!class_id || !subject_id) return res.status(400).send('Class and Subject are required to generate template.');

    try {
        // Verify class and subject belong to this school
        const klass = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [Number(class_id), schoolId]);
        const subjectCheck = await db.get('SELECT id FROM subjects WHERE id = ? AND school_id = ?', [Number(subject_id), schoolId]);
        if (!klass || !subjectCheck) {
            return res.status(403).send('Access Denied: Class or Subject does not belong to this school.');
        }

        const resultController = require('./resultController');
        const settings = await resultController.getSectionResultConfig(Number(class_id), schoolId);
        const caCount = parseInt(settings.ca_count || '2');

        const settingsRow = await db.get(
            "SELECT value FROM settings WHERE key = 'current_session' AND school_id = ? ORDER BY school_id DESC LIMIT 1",
            [schoolId]
        );
        const currentSession = settingsRow ? settingsRow.value : '2025/2026';

        const students = await getEnrolledStudents(Number(class_id), currentSession);

        const subject = await db.get('SELECT name FROM subjects WHERE id = ? AND school_id = ?', [Number(subject_id), schoolId]);
        const className = await db.get('SELECT name FROM classes WHERE id = ? AND school_id = ?', [Number(class_id), schoolId]);

        if (!students.length) return res.status(404).send('No active students found in this class.');

        const data = students.map(s => {
            const row = {
                'student_id': s.admission_number,
                'name': `${s.first_name} ${s.last_name}`,
                'subject': subject ? subject.name : '',
                'ca1': ''
            };
            if (caCount === 2) row['ca2'] = '';
            row['exam'] = '';
            return row;
        });

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(data);

        const wscols = [
            { wch: 15 },
            { wch: 30 },
            { wch: 10 },
            { wch: 10 },
            { wch: 10 }
        ];
        if (caCount === 1) wscols.splice(3, 1);

        ws['!cols'] = wscols;

        xlsx.utils.book_append_sheet(wb, ws, "Marks");

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="Result_Template_${className ? className.name : 'Class'}_${subject ? subject.name : 'Subject'}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (err) {
        console.error('Template Error:', err);
        res.status(500).send('Database Error');
    }
};

const getImportPage = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
        const subjects = await db.all('SELECT * FROM subjects WHERE school_id = ? ORDER BY name ASC', [schoolId]);

        res.render('results/import', {
            title: 'Bulk Result Import',
            classes,
            subjects
        });
    } catch (err) {
        console.error('Import Page Error:', err);
        res.status(500).send('Database Error');
    }
};

const processImport = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { class_id, subject_id, term, session } = req.body;
    const file = req.file;

    // Validate required import parameters
    if (!term || !session) {
        return res.status(400).json({ success: false, message: 'Term and session are required for import.' });
    }

    if (!file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        const workbook = xlsx.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const errors = [];
        const resultsToSave = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const admissionNo = row['student_id'] || row['Admission Number'] || row['ADMISSION NUMBER'];
            const subjectName = row['subject'] || row['SUBJECT'];
            const ca1 = parseFloat(row['ca1'] || row['CA1'] || 0);
            const ca2 = parseFloat(row['ca2'] || row['CA2'] || 0);
            const exam = parseFloat(row['exam'] || row['Exam'] || row['EXAM'] || 0);

            if (!admissionNo) {
                errors.push(`Row ${i + 2}: Student ID is missing.`);
                continue;
            }

            const student = await db.get(
                'SELECT id FROM students WHERE admission_number = ? AND school_id = ?',
                [admissionNo.toString(), schoolId]
            );
            if (!student) {
                errors.push(`Row ${i + 2}: Student with ID ${admissionNo} not found in this school.`);
                continue;
            }

            let activeSubjectId = Number(subject_id);
            if (subjectName) {
                const sub = await db.get(
                    'SELECT id FROM subjects WHERE LOWER(name) = LOWER(?) AND school_id = ?',
                    [subjectName, schoolId]
                );
                if (sub) activeSubjectId = Number(sub.id);
                else {
                    errors.push(`Row ${i + 2}: Subject "${subjectName}" not found in system.`);
                    continue;
                }
            }

            const { total, grade } = computeResult(ca1, ca2, exam);
            resultsToSave.push({
                student_id: student.id,
                subject_id: activeSubjectId,
                ca1, ca2, exam, total, grade
            });
        }

        if (errors.length > 0) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ success: false, errors });
        }

        const insertSql = `
            INSERT INTO results (student_id, subject_id, term, session, ca1, ca2, exam, total, grade)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, subject_id, term, session) DO UPDATE SET
            ca1=excluded.ca1, ca2=excluded.ca2, exam=excluded.exam, 
            total=excluded.total, grade=excluded.grade
        `;

        await db.transaction(async (txClient) => {
            for (const item of resultsToSave) {
                await db.run(insertSql, [
                    Number(item.student_id),
                    Number(item.subject_id),
                    String(term),
                    String(session),
                    Number(item.ca1) || 0,
                    Number(item.ca2) || 0,
                    Number(item.exam) || 0,
                    Number(item.total) || 0,
                    String(item.grade || '')
                ], txClient);
            }
        });

        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        res.json({ success: true, message: `Successfully imported ${resultsToSave.length} results.` });

    } catch (err) {
        console.error('Process Import Error:', err);
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = { getImportPage, processImport, downloadTemplate };


