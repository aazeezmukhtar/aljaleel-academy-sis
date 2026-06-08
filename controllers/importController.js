const db = require('../utils/db');
const xlsx = require('xlsx');
const fs = require('fs');
const { computeResult } = require('../utils/resultHelper');

const downloadTemplate = async (req, res) => {
    const { class_id, subject_id } = req.query;

    if (!class_id || !subject_id) return res.status(400).send('Class and Subject are required to generate template.');

    try {
        const configArr = await db.all('SELECT * FROM result_config');
        const settings = {};
        configArr.forEach(c => settings[c.key] = c.value);
        const caCount = parseInt(settings.ca_count || '2');

        // Retrieve class's section current session dynamically
        const secRow = await db.get(`
            SELECT s.current_session 
            FROM sections s 
            JOIN classes c ON c.section_id = s.id 
            WHERE c.id = ?
        `, [class_id]);
        const session = secRow ? secRow.current_session : '2024/2025';

        const students = await db.all(`
            SELECT s.admission_number, s.first_name, s.last_name 
            FROM students s
            JOIN student_enrollments se ON s.id = se.student_id
            WHERE se.class_id = ? AND se.session = ? AND s.status = 'active'
            ORDER BY s.last_name, s.first_name
        `, [class_id, session]);

        const subject = await db.get('SELECT name FROM subjects WHERE id = ?', [subject_id]);
        const className = await db.get('SELECT name FROM classes WHERE id = ?', [class_id]);

        if (!students.length) return res.status(404).send('No active students found in this class.');

        const data = students.map(s => {
            const row = {
                'student_id': s.admission_number,
                'name': `${s.first_name} ${s.last_name}`,
                'subject': subject.name,
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

        res.setHeader('Content-Disposition', `attachment; filename="Result_Template_${className.name}_${subject.name}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (err) {
        console.error('Template Error:', err);
        res.status(500).send('Database Error');
    }
};

const getImportPage = async (req, res) => {
    try {
        const classes = await db.all('SELECT * FROM classes');
        const subjects = await db.all('SELECT * FROM subjects');

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
    const { class_id, subject_id, term, session } = req.body;
    const file = req.file;

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

            const student = await db.get('SELECT id FROM students WHERE admission_number = ?', [admissionNo.toString()]);
            if (!student) {
                errors.push(`Row ${i + 2}: Student with ID ${admissionNo} not found.`);
                continue;
            }

            let activeSubjectId = subject_id;
            if (subjectName) {
                const subQuery = db.DB_TYPE === 'postgres' 
                    ? 'SELECT id FROM subjects WHERE name ILIKE ?'
                    : 'SELECT id FROM subjects WHERE name = ? COLLATE NOCASE';
                const sub = await db.get(subQuery, [subjectName]);
                if (sub) activeSubjectId = sub.id;
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

        // Transaction handling
        await db.transaction(async (client) => {
            for (const item of resultsToSave) {
                const sql = `
                    INSERT INTO results (student_id, subject_id, term, session, ca1, ca2, exam, total, grade)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(student_id, subject_id, term, session) DO UPDATE SET
                    ca1=excluded.ca1, ca2=excluded.ca2, exam=excluded.exam, 
                    total=excluded.total, grade=excluded.grade
                `;
                const params = [item.student_id, item.subject_id, term, session, item.ca1, item.ca2, item.exam, item.total, item.grade];
                
                if (db.DB_TYPE === 'postgres') {
                    await client.query(sql.replace(/\?/g, (val, j) => `$${j + 1}`), params);
                } else {
                    db.run(sql, params); // Note: inside transaction callback, better use client if provided, but our db.js for sqlite uses sqliteDb directly
                }
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
