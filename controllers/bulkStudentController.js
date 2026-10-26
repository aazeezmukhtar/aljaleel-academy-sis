const db = require('../utils/db');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const { generateUniqueID } = require('../utils/idHelper');
const bcrypt = require('bcryptjs');
const sessionHelper = require('../utils/sessionHelper');

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

const removeUploadedFile = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (err) {
            console.error('Bulk Import File Cleanup Error:', err.message);
        }
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
        const fileExtension = path.extname(file.originalname).toLowerCase();
        if (fileExtension !== '.xlsx' && fileExtension !== '.xls') {
            return res.status(400).json({
                success: false,
                message: 'Unsupported file format. Please upload an XLSX file.'
            });
        }

        const workbook = xlsx.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        if (!sheetName || !workbook.Sheets[sheetName]) {
            return res.status(400).json({ success: false, message: 'The uploaded workbook has no readable worksheet.' });
        }

        const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        if (!rawData.length) {
            return res.status(400).json({ success: false, message: 'The uploaded worksheet contains no students.' });
        }

        const studentsData = rawData.map(row => ({
            admission_number: row['Admission Number'] || row['ADMISSION NUMBER'] || row['admission_number'],
            first_name: row['First Name'] || row['FIRST NAME'] || row['first_name'],
            last_name: row['Last Name'] || row['LAST NAME'] || row['last_name'],
            gender: row['Gender'] || row['GENDER'] || row['gender'],
            dob: row['Date of Birth'] || row['DOB'] || row['dob'],
            class_id: row['Class ID'] || row['class_id'] || default_class_id
        }));

        const errors = [];
        const duplicates = [];
        const admissionNumbers = [];
        const seenAdmissions = new Map();
        const validStudents = [];

        const classes = await db.all(
            'SELECT id, section_id FROM classes WHERE school_id = ?',
            [schoolId]
        );
        const classMap = new Map(classes.map(c => [String(c.id), c]));

        studentsData.forEach((student, index) => {
            const rowNum = index + 2;
            student.first_name = student.first_name == null ? '' : String(student.first_name).trim();
            student.last_name = student.last_name == null ? '' : String(student.last_name).trim();
            student.gender = student.gender == null ? '' : String(student.gender).trim();
            student.admission_number = student.admission_number == null ? '' : String(student.admission_number).trim();
            student.class_id = student.class_id == null || String(student.class_id).trim() === ''
                ? null
                : String(student.class_id).trim();

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

            const normalizedGender = student.gender.toLowerCase();
            const genderMap = { male: 'Male', m: 'Male', female: 'Female', f: 'Female', other: 'Other', o: 'Other' };
            if (!genderMap[normalizedGender]) {
                errors.push(`Row ${rowNum}: Invalid Gender (must be Male, Female, or Other)`);
                return;
            }
            student.gender = genderMap[normalizedGender];

            if (typeof student.dob === 'number') {
                const excelEpoch = new Date(1899, 11, 30);
                const date = new Date(excelEpoch.getTime() + student.dob * 86400000);
                if (!Number.isNaN(date.getTime())) student.dob = date.toISOString().split('T')[0];
                else {
                    errors.push(`Row ${rowNum}: Invalid Date of Birth`);
                    return;
                }
            } else if (student.dob) {
                student.dob = String(student.dob).trim();
            } else {
                student.dob = null;
            }

            if (student.class_id && !classMap.has(student.class_id)) {
                errors.push(`Row ${rowNum}: Class ID ${student.class_id} does not belong to this academy`);
                return;
            }

            if (student.admission_number) {
                const previousRow = seenAdmissions.get(student.admission_number);
                if (previousRow) {
                    duplicates.push({
                        row: rowNum,
                        admission_number: student.admission_number,
                        message: `Admission number ${student.admission_number} is repeated in rows ${previousRow} and ${rowNum} of this file`
                    });
                } else {
                    seenAdmissions.set(student.admission_number, rowNum);
                    admissionNumbers.push(student.admission_number);
                }
            }

            validStudents.push({ ...student, rowNum });
        });

        if (admissionNumbers.length > 0) {
            // Query in small batches to avoid database parameter limits on large spreadsheets.
            const existingSet = new Set();
            for (let offset = 0; offset < admissionNumbers.length; offset += 500) {
                const batch = admissionNumbers.slice(offset, offset + 500);
                const placeholders = batch.map(() => '?').join(',');
                const existingAdmissions = await db.all(
                    `SELECT admission_number FROM students WHERE admission_number IN (${placeholders}) AND school_id = ?`,
                    [...batch, schoolId]
                );
                existingAdmissions.forEach(row => existingSet.add(String(row.admission_number)));
            }
            admissionNumbers.forEach(number => {
                if (existingSet.has(number)) {
                    duplicates.push({
                        admission_number: number,
                        message: `Admission number ${number} already exists in the academy database`
                    });
                }
            });
        }

        if (errors.length > 0 || duplicates.length > 0) {
            return res.status(400).json({
                success: false,
                errors,
                duplicates,
                message: `Import failed: ${errors.length} validation error(s), ${duplicates.length} duplicate(s) found.`
            });
        }

        // Resolve every assigned class's calendar before writing anything. A missing calendar
        // is an error, not a reason to silently assign an arbitrary session or term.
        const academicContexts = new Map();
        for (const student of validStudents) {
            if (!student.class_id || academicContexts.has(student.class_id)) continue;
            const context = await sessionHelper.getAcademicContext(Number(student.class_id), schoolId);
            if (!context || !context.session || !context.term) {
                errors.push(`Row ${student.rowNum}: No active academic session and term are configured for the selected class`);
                continue;
            }
            academicContexts.set(student.class_id, {
                session: context.session,
                term: context.term
            });
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                errors,
                duplicates: [],
                message: `Import failed: ${errors.length} academic-context validation error(s).`
            });
        }

        // Prepare generated admission numbers and password hashes before opening the transaction.
        for (const student of validStudents) {
            if (!student.admission_number) student.admission_number = await generateUniqueID();
            student.hashedPassword = await bcrypt.hash(String(student.admission_number), 10);
        }

        await db.transaction(async (client) => {
            for (const student of validStudents) {
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
                    student.admission_number,
                    student.class_id || null,
                    student.hashedPassword
                ], client);

                if (student.class_id) {
                    const studentRow = await db.get(
                        'SELECT id FROM students WHERE admission_number = ? AND school_id = ?',
                        [student.admission_number, schoolId],
                        client
                    );
                    if (!studentRow) {
                        throw new Error(`Could not verify the inserted student in row ${student.rowNum}`);
                    }

                    const context = academicContexts.get(student.class_id);
                    await db.run(
                        'INSERT INTO student_enrollments (student_id, class_id, session, term) VALUES (?, ?, ?, ?)',
                        [studentRow.id, Number(student.class_id), context.session, context.term],
                        client
                    );
                }
            }
        });

        removeUploadedFile(file.path);
        return res.json({
            success: true,
            message: `Successfully imported ${validStudents.length} student(s).`,
            count: validStudents.length
        });

    } catch (err) {
        console.error('Bulk Import Error:', err);
        removeUploadedFile(file.path);
        return res.status(500).json({
            success: false,
            message: 'Bulk import failed. No students were imported. Please check the file and academic calendar, then try again.'
        });
    }
};

module.exports = { getBulkImportPage, processBulkImport };
