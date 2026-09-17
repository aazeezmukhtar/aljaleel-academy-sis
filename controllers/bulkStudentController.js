const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const { generateUniqueID } = require('../utils/idHelper');
const bcrypt = require('bcryptjs');

const getBulkImportPage = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name ASC', [schoolId]);
        res.render('students/bulk-import', {
            title: 'Bulk Student Import',
            classes
        });
    } catch (err) {
        console.error('Bulk Import Page Error:', err);
        res.status(500).send('Database Error');
    }
};

const processBulkImport = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { default_class_id } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        let studentsData = [];
        const fileExtension = path.extname(file.originalname).toLowerCase();

        if (fileExtension === '.xlsx' || fileExtension === '.xls') {
            const workbook = xlsx.readFile(file.path);
            const sheetName = workbook.SheetNames[0];
            const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

            studentsData = rawData.map(row => ({
                admission_number: row['Admission Number'] || row['ADMISSION NUMBER'] || row['admission_number'],
                first_name: row['First Name'] || row['FIRST NAME'] || row['first_name'],
                last_name: row['Last Name'] || row['LAST NAME'] || row['last_name'],
                gender: row['Gender'] || row['GENDER'] || row['gender'],
                dob: row['Date of Birth'] || row['DOB'] || row['dob'],
                class_id: row['Class ID'] || row['class_id'] || default_class_id
            }));
        } else {
            fs.unlinkSync(file.path);
            return res.status(400).json({
                success: false,
                message: 'Unsupported file format. Please upload an XLSX file.'
            });
        }

        const errors = [];
        const duplicates = [];
        const validStudents = [];
        const admissionNumbers = [];

        studentsData.forEach((student, index) => {
            const rowNum = index + 2;

            if (!student.first_name) {
                errors.push(`Row ${rowNum}: Missing First Name`);
                return;
            }
            if (!student.last_name) {
                errors.push(`Row ${rowNum}: Missing Last Name`);
                return;
            }
            if (!student.gender) {
                errors.push(`Row ${rowNum}: Missing Gender`);
                return;
            }

            const validGenders = ['Male', 'Female', 'Other', 'male', 'female', 'other', 'M', 'F'];
            if (!validGenders.includes(student.gender)) {
                errors.push(`Row ${rowNum}: Invalid Gender (must be Male, Female, or Other)`);
                return;
            }

            const genderMap = {
                'male': 'Male', 'M': 'Male', 'm': 'Male',
                'female': 'Female', 'F': 'Female', 'f': 'Female',
                'other': 'Other', 'O': 'Other', 'o': 'Other'
            };
            student.gender = genderMap[student.gender] || student.gender;

            if (typeof student.dob === 'number') {
                const excelEpoch = new Date(1899, 11, 30);
                const date = new Date(excelEpoch.getTime() + student.dob * 86400000);
                student.dob = date.toISOString().split('T')[0];
            }

            if (student.admission_number) {
                admissionNumbers.push({ number: String(student.admission_number).trim(), row: rowNum });
            }

            validStudents.push({ ...student, rowNum });
        });

        if (admissionNumbers.length > 0) {
            const placeholders = admissionNumbers.map(() => '?').join(',');
            const existingAdmissions = await db.all(
                `SELECT admission_number FROM students WHERE admission_number IN (${placeholders}) AND school_id = ?`,
                [...admissionNumbers.map(a => a.number), schoolId]
            );

            const existingSet = new Set(existingAdmissions.map(a => a.admission_number));

            admissionNumbers.forEach(({ number, row }) => {
                if (existingSet.has(number)) {
                    duplicates.push({
                        row,
                        admission_number: number,
                        message: `Admission number ${number} already exists in database`
                    });
                }
            });
        }

        if (errors.length > 0 || duplicates.length > 0) {
            fs.unlinkSync(file.path);
            return res.status(400).json({
                success: false,
                errors,
                duplicates,
                message: `Import failed: ${errors.length} validation error(s), ${duplicates.length} duplicate(s) found.`
            });
        }

        let currentSession = await sessionHelper.getCurrentSession(schoolId) || '2026/2027';

        await db.transaction(async () => {
            for (const student of validStudents) {
                const admission_number = student.admission_number || await generateUniqueID();
                const hashedPassword = await bcrypt.hash(admission_number.toString(), 10);
                await db.run(`
                    INSERT INTO students (
                        school_id, first_name, last_name, gender, dob, admission_number,
                        current_class_id, password, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
                `, [
                    schoolId,
                    student.first_name,
                    student.last_name,
                    student.gender,
                    student.dob || null,
                    admission_number,
                    student.class_id || null,
                    hashedPassword
                ]);

                if (student.class_id) {
                    const studentRow = await db.get(
                        "SELECT id FROM students WHERE admission_number = ? AND school_id = ?",
                        [admission_number, schoolId]
                    );
                    if (studentRow) {
                        const classRow = await db.get('SELECT section_id FROM classes WHERE id = ? AND school_id = ?', [student.class_id, schoolId]);
                        let sessionToUse = currentSession;
                        if (classRow && classRow.section_id) {
                            const secCtx = await sessionHelper.getSectionContext(classRow.section_id, schoolId);
                            if (secCtx && secCtx.session) sessionToUse = secCtx.session;
                        }
                        await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)", [studentRow.id, student.class_id, sessionToUse]);
                    }
                }
            }
        });

        fs.unlinkSync(file.path);

        res.json({
            success: true,
            message: `Successfully imported ${validStudents.length} student(s).`,
            count: validStudents.length
        });

    } catch (err) {
        console.error('Bulk Import Error:', err);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error: ' + err.message
        });
    }
};

module.exports = { getBulkImportPage, processBulkImport };
