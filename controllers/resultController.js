const db = require('../utils/db');
const path = require('path');
const { computeResult, getGrade } = require('../utils/resultHelper');
const { logAction } = require('../utils/logger');

const getOrdinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const getResultsDashboard = (req, res) => {
    res.render('results/index', {
        title: 'Result Management'
    });
};

const getSchoolSettings = async () => {
    const settingsArr = await db.all('SELECT * FROM settings');
    const configArr = await db.all('SELECT * FROM result_config');
    const settings = {};
    settingsArr.forEach(s => settings[s.key] = s.value);
    configArr.forEach(c => settings[c.key] = c.value); 
    return settings;
};

const getGradingSystem = async (req, res) => {
    try {
        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');
        const config = await getSchoolSettings();

        if (req && res) {
            res.render('results/setup', {
                title: 'Result Configuration',
                grading,
                config
            });
        }
        return { grading, config };
    } catch (err) {
        console.error('Get Grading Error:', err);
        if (res) res.status(500).send('Database Error');
    }
};

const saveResultConfig = async (req, res) => {
    const { ca1_max, ca2_max, exam_max } = req.body;
    try {
        const sql = 'INSERT INTO result_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
        await db.transaction(async () => {
            await db.run(sql, ['ca_count', req.body.ca_count || '2']);
            await db.run(sql, ['ca1_max', ca1_max]);
            await db.run(sql, ['ca2_max', ca2_max]);
            await db.run(sql, ['exam_max', exam_max]);
        });
        res.json({ success: true, message: 'Assessment limits updated.' });
    } catch (err) {
        console.error('Save Config Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save config.' });
    }
};

const saveGradingSystem = async (req, res) => {
    const { grades } = req.body;
    try {
        const insertSql = `
            INSERT INTO grading_systems (id, min_score, max_score, grade, remark)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
            min_score=excluded.min_score, max_score=excluded.max_score,
            grade=excluded.grade, remark=excluded.remark
        `;
        const deleteSql = 'DELETE FROM grading_systems WHERE id = ?';

        await db.transaction(async () => {
            for (const g of grades) {
                if (g.deleted) {
                    await db.run(deleteSql, [g.id]);
                } else {
                    await db.run(insertSql, [g.id || null, g.min, g.max, g.grade, g.remark]);
                }
            }
        });

        res.json({ success: true, message: 'Grading system updated.' });
    } catch (err) {
        console.error('Save Grading Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save grading.' });
    }
};


const getResultManager = async (req, res) => {
    const user = req.session.staff;
    const settings = await getSchoolSettings();
    const activeSession = req.query.session || settings.current_session || '2025/2026';
    const activeTerm = req.query.term || settings.current_term || '1st Term';
    const { class_id, subject_id } = req.query;

    try {
        let classes, subjects;

        if (user.role === 'Admin' || user.role === 'Examination Officer') {
            classes = await db.all('SELECT * FROM classes');
            subjects = await db.all('SELECT * FROM subjects');
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.* FROM classes c
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                WHERE sa.id IS NOT NULL OR ca.id IS NOT NULL
            `, [user.id, user.id]);

            subjects = await db.all(`
                SELECT DISTINCT s.* FROM subjects s
                JOIN subject_assignments sa ON s.id = sa.subject_id
                WHERE sa.teacher_id = ?
            `, [user.id]);
        }

        let students = [];

        if (class_id && subject_id) {
            if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
                const hasAccess = await db.get(`
                    SELECT id FROM subject_assignments 
                    WHERE teacher_id = ? AND class_id = ? AND subject_id = ?
                `, [user.id, class_id, subject_id]);
                if (!hasAccess) return res.redirect('/results?error=Access Denied to this Subject/Class combination');
            }

            students = await db.all(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number, s.passport_photo_path,
                       r.ca1, r.ca2, r.exam, r.total, r.grade, r.status, r.teacher_remark
                FROM students s 
                LEFT JOIN results r ON s.id = r.student_id 
                    AND r.subject_id = ? AND r.term = ? AND r.session = ?
                WHERE s.current_class_id = ? AND s.status = 'active'
                ORDER BY s.last_name, s.first_name
            `, [subject_id, activeTerm, activeSession, class_id]);
        }

        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');

        res.render('results/manager', {
            title: 'Result Management',
            classes,
            subjects,
            students,
            filters: { class_id, subject_id, term: activeTerm, session: activeSession },
            school: settings,
            grading
        });
    } catch (err) {
        console.error('Result Manager Error:', err);
        res.status(500).send('Database Error');
    }
};

const saveResults = async (req, res) => {
    const { results, term, session, subject_id, class_id, status } = req.body; 
    const user = req.session.staff;

    if (!results || results.length === 0) {
        return res.json({ success: false, message: 'No results to save.' });
    }

    try {
        if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
            const hasAccess = await db.get(`
                SELECT id FROM subject_assignments 
                WHERE teacher_id = ? AND class_id = ? AND subject_id = ?
            `, [user.id, class_id, subject_id]);
            if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized' });

            const checkLock = await db.get("SELECT status FROM results WHERE student_id = ? AND subject_id = ? AND term = ? AND session = ?", [results[0]?.student_id, subject_id, term, session]);
            if (checkLock && (checkLock.status === 'locked' || checkLock.status === 'published' || checkLock.status === 'approved')) {
                return res.status(403).json({ success: false, message: 'Results are LOCKED or PUBLISHED and cannot be edited.' });
            }
        }

        const sql = `
            INSERT INTO results (student_id, subject_id, term, session, ca1, ca2, exam, total, grade, teacher_remark, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, subject_id, term, session) DO UPDATE SET
            ca1=excluded.ca1, ca2=excluded.ca2, exam=excluded.exam, 
            total=excluded.total, grade=excluded.grade, 
            teacher_remark=excluded.teacher_remark, status=excluded.status
        `;

        await db.transaction(async () => {
            for (const item of results) {
                await db.run(sql, [
                    item.student_id, subject_id, term, session,
                    item.ca1 || 0, item.ca2 || 0, item.exam || 0,
                    item.total || 0, (item.grade || '').trim(), (item.remark || '').trim(),
                    status || 'draft'
                ]);
            }
        });

        res.json({ success: true, message: `Results ${status === 'submitted' ? 'submitted' : 'saved'} successfully.` });
    } catch (err) {
        console.error('Save Results Error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to save results.' });
    }
};

const getReportCard = async (req, res) => {
    const { student_id } = req.params;
    const { term, session } = req.query;

    try {
        const school = await getSchoolSettings();
        const student = await db.get(`
            SELECT s.*, c.name as class_name 
            FROM students s
            LEFT JOIN classes c ON s.current_class_id = c.id
            WHERE s.id = ?
        `, [student_id]);

        if (!student) return res.status(404).send('Student not found');

        // Results with subject rank
        const results = await db.all(`
            SELECT r.*, s.name as subject_name,
            (SELECT COUNT(*) + 1 FROM results r2 
             WHERE r2.subject_id = r.subject_id AND r2.term = r.term 
             AND r2.session = r.session AND r2.total > r.total
             AND r2.student_id IN (SELECT id FROM students WHERE current_class_id = ?)) as subject_rank
            FROM results r
            JOIN subjects s ON r.subject_id = s.id
            WHERE r.student_id = ? AND r.term = ? AND r.session = ?
        `, [student.current_class_id, student_id, term, session]);

        // Overall Position
        const classPerformance = await db.all(`
            SELECT student_id, SUM(total) as student_total
            FROM results
            WHERE term = ? AND session = ? 
            AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
            GROUP BY student_id
            ORDER BY student_total DESC
        `, [term, session, student.current_class_id]);

        const studentPerf = classPerformance.find(p => p.student_id == student_id);
        const position = studentPerf ? classPerformance.indexOf(studentPerf) + 1 : 0;
        const classCount = classPerformance.length;

        // Attendance
        const attendance = await db.get(`
            SELECT COUNT(*) as present_count FROM attendance 
            WHERE student_id = ? AND status = 'Present'
        `, [student_id]) || { present_count: 0 };

        // Traits
        const traitRows = await db.all(`
            SELECT trait_name, score FROM affective_psychomotor
            WHERE student_id = ? AND term = ? AND session = ?
        `, [student_id, term, session]) || [];
        const traits = {};
        traitRows.forEach(t => traits[t.trait_name] = t.score);

        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');

        // Performance Analysis Logic
        const myIndex = classPerformance.findIndex(p => p.student_id == student_id);
        const marksAnalysis = [];
        if (studentPerf) {
            if (myIndex > 0) {
                const studentAhead = classPerformance[myIndex - 1];
                const diff = (studentAhead.student_total - studentPerf.student_total).toFixed(1);
                marksAnalysis.push(`${diff} marks behind the ${getOrdinal(myIndex)} student`);
                if (diff <= 5) marksAnalysis.push(`Very close to the next position`);
            }

            const tiedOthers = classPerformance.filter(p => p.student_total === studentPerf.student_total && p.student_id != student_id).length;
            if (tiedOthers > 0) {
                marksAnalysis.push(`Currently tied with ${tiedOthers} other(s) at this position`);
            }

            if (myIndex < classPerformance.length - 1) {
                const studentBehind = classPerformance[myIndex + 1];
                const diff = (studentPerf.student_total - studentBehind.student_total).toFixed(1);
                marksAnalysis.push(`${diff} marks ahead of the ${getOrdinal(myIndex + 2)} student`);
            }
        }

        res.render('results/report', {
            title: `Report Card - ${student.first_name}`,
            student,
            results,
            attendance: attendance ? attendance.present_count : 0,
            traits,
            term,
            session,
            school,
            position,
            classCount,
            grading,
            caCount: school.ca_count || 2,
            marksAnalysis
        });
    } catch (err) {
        console.error('Report Card Error:', err);
        res.status(500).send('Database Error');
    }
};

const getCumulativeReport = async (req, res) => {
    const { student_id } = req.params;
    const { session } = req.query;

    try {
        const school = await getSchoolSettings();
        const student = await db.get(`
            SELECT s.*, c.name as class_name 
            FROM students s
            LEFT JOIN classes c ON s.current_class_id = c.id
            WHERE s.id = ?
        `, [student_id]);

        if (!student) return res.status(404).send('Student not found');

        const rawResults = await db.all(`
            SELECT r.*, s.name as subject_name
            FROM results r
            JOIN subjects s ON r.subject_id = s.id
            WHERE r.student_id = ? AND r.session = ?
        `, [student_id, session]);

        const subjectMap = {};
        rawResults.forEach(r => {
            if (!subjectMap[r.subject_id]) {
                subjectMap[r.subject_id] = { name: r.subject_name, terms: {}, avg: 0 };
            }
            subjectMap[r.subject_id].terms[r.term] = r.total;
        });

        const subjects = Object.values(subjectMap);

        const sessionPerformance = await db.all(`
            SELECT student_id, AVG(total) as session_avg
            FROM results
            WHERE session = ? AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
            GROUP BY student_id
            ORDER BY session_avg DESC
        `, [session, student.current_class_id]);

        const studentPerf = sessionPerformance.find(p => p.student_id == student_id);
        const position = studentPerf ? sessionPerformance.indexOf(studentPerf) + 1 : 0;
        const classCount = sessionPerformance.length;

        const marksAnalysis = [];
        if (studentPerf) {
            const mySessIndex = sessionPerformance.indexOf(studentPerf);
            if (mySessIndex > 0) {
                const ahead = sessionPerformance[mySessIndex - 1];
                const diff = (ahead.session_avg - studentPerf.session_avg).toFixed(1);
                marksAnalysis.push(`${diff} avg marks behind the ${getOrdinal(mySessIndex)} student`);
            }
            
            const tiedOthers = sessionPerformance.filter(p => p.session_avg === studentPerf.session_avg && p.student_id != student_id).length;
            if (tiedOthers > 0) {
                marksAnalysis.push(`Currently tied with ${tiedOthers} other(s) at this position`);
            }

            if (mySessIndex < sessionPerformance.length - 1) {
                const behind = sessionPerformance[mySessIndex + 1];
                const diff = (studentPerf.session_avg - behind.session_avg).toFixed(1);
                marksAnalysis.push(`${diff} avg marks ahead of the ${getOrdinal(mySessIndex + 2)} student`);
            }
        }

        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');

        res.render('results/cumulative', {
            title: 'Cumulative Report',
            student,
            subjects,
            getGrade,
            position,
            classCount,
            session,
            school,
            grading,
            marksAnalysis
        });
    } catch (err) {
        console.error('Cumulative Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getBulkReport = async (req, res) => {
    const { class_id, term, session } = req.query;
    const user = req.session.staff;

    try {
        if (!class_id || !term || !session) {
            let classes;
            if (user.role === 'Admin' || user.role === 'Examination Officer') {
                classes = await db.all('SELECT * FROM classes ORDER BY name');
            } else {
                classes = await db.all(`
                    SELECT DISTINCT c.* FROM classes c
                    JOIN class_assignments ca ON c.id = ca.class_id
                    WHERE ca.staff_id = ?
                    ORDER BY c.name
                `, [user.id]);
            }
            return res.render('results/bulk_select', {
                title: 'Print Report Cards',
                classes,
                filters: { class_id, term, session },
                error: req.query.error || null,
                user
            });
        }

        if (term === 'Cumulative') {
            return res.redirect(`/results/bulk-cumulative?class_id=${class_id}&session=${encodeURIComponent(session)}`);
        }

        const school = await getSchoolSettings();
        const students = await db.all("SELECT * FROM students WHERE current_class_id = ? AND status = 'active' ORDER BY last_name, first_name", [class_id]);
        const classInfo = await db.get('SELECT name FROM classes WHERE id = ?', [class_id]);
        const className = classInfo ? classInfo.name : 'Class';

        const classPerformance = await db.all(`
            SELECT student_id, SUM(total) as student_total
            FROM results
            WHERE term = ? AND session = ? 
            AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
            GROUP BY student_id
            ORDER BY student_total DESC
        `, [term, session, class_id]);

        const studentsData = [];
        for (const student of students) {
            const results = await db.all(`
                SELECT r.*, s.name as subject_name,
                (SELECT COUNT(*) + 1 FROM results r2 
                 WHERE r2.subject_id = r.subject_id AND r2.term = r.term 
                 AND r2.session = r.session AND r2.total > r.total
                 AND r2.student_id IN (SELECT id FROM students WHERE current_class_id = ?)) as subject_rank
                FROM results r
                JOIN subjects s ON r.subject_id = s.id
                WHERE r.student_id = ? AND r.term = ? AND r.session = ?
            `, [class_id, student.id, term, session]);

            const studentPerf = classPerformance.find(p => p.student_id == student.id);
            const position = studentPerf ? classPerformance.indexOf(studentPerf) + 1 : 0;

            const traitRows = await db.all(`
                SELECT trait_name, score FROM affective_psychomotor
                WHERE student_id = ? AND term = ? AND session = ?
            `, [student.id, term, session]);
            const traits = {};
            traitRows.forEach(t => traits[t.trait_name] = t.score);

            const attendance = await db.get(`
                SELECT COUNT(*) as present_count FROM attendance 
                WHERE student_id = ? AND status = 'Present'
            `, [student.id]) || { present_count: 0 };

            const myIndex = classPerformance.indexOf(studentPerf);
            const marksAnalysis = [];
            if (studentPerf) {
                if (myIndex > 0) {
                    const studentAhead = classPerformance[myIndex - 1];
                    const diff = (studentAhead.student_total - studentPerf.student_total).toFixed(1);
                    marksAnalysis.push(`${diff} marks behind the ${getOrdinal(myIndex)} student`);
                }

                const tiedOthers = classPerformance.filter(p => p.student_total === studentPerf.student_total && p.student_id != student.id).length;
                if (tiedOthers > 0) {
                    marksAnalysis.push(`Currently tied with ${tiedOthers} other(s) at this position`);
                }

                if (myIndex < classPerformance.length - 1) {
                    const studentBehind = classPerformance[myIndex + 1];
                    const diff = (studentPerf.student_total - studentBehind.student_total).toFixed(1);
                    marksAnalysis.push(`${diff} marks ahead of the ${getOrdinal(myIndex + 2)} student`);
                }
            }

            studentsData.push({
                student: { ...student, class_name: className },
                results,
                position,
                traits,
                attendance: attendance ? attendance.present_count : 0,
                marksAnalysis
            });
        }

        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');

        res.render('results/bulk_report', {
            title: `Bulk Report - ${className}`,
            studentsData,
            term,
            session,
            school,
            grading,
            classCount: classPerformance.length,
            caCount: school.ca_count || 2
        });
    } catch (err) {
        console.error('Bulk Report Error:', err);
        res.status(500).send('Database Error');
    }
};


const getBulkCumulative = async (req, res) => {
    const { class_id, session } = req.query;
    try {
        const school = await getSchoolSettings();
        const students = await db.all("SELECT * FROM students WHERE current_class_id = ? AND status = 'active' ORDER BY last_name, first_name", [class_id]);
        const classInfo = await db.get('SELECT name FROM classes WHERE id = ?', [class_id]);
        const className = classInfo ? classInfo.name : 'Class';

        const sessionPerformance = await db.all(`
            SELECT student_id, AVG(total) as session_avg
            FROM results
            WHERE session = ? AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
            GROUP BY student_id
            ORDER BY session_avg DESC
        `, [session, class_id]);

        const studentsData = [];
        for (const student of students) {
            const rawResults = await db.all(`
                SELECT r.*, s.name as subject_name
                FROM results r
                JOIN subjects s ON r.subject_id = s.id
                WHERE r.student_id = ? AND r.session = ?
            `, [student.id, session]);

            const subjectMap = {};
            rawResults.forEach(r => {
                if (!subjectMap[r.subject_id]) {
                    subjectMap[r.subject_id] = { name: r.subject_name, terms: {}, avg: 0 };
                }
                subjectMap[r.subject_id].terms[r.term] = r.total;
            });

            const studentPerf = sessionPerformance.find(p => p.student_id == student.id);
            const position = studentPerf ? sessionPerformance.indexOf(studentPerf) + 1 : 0;

            const marksAnalysis = [];
            if (studentPerf) {
                const mySessIndex = sessionPerformance.indexOf(studentPerf);
                if (mySessIndex > 0) {
                    const ahead = sessionPerformance[mySessIndex - 1];
                    const diff = (ahead.session_avg - studentPerf.session_avg).toFixed(1);
                    marksAnalysis.push(`${diff} avg marks behind the ${getOrdinal(mySessIndex)} student`);
                }
                
                const tiedOthers = sessionPerformance.filter(p => p.session_avg === studentPerf.session_avg && p.student_id != student.id).length;
                if (tiedOthers > 0) {
                    marksAnalysis.push(`Currently tied with ${tiedOthers} other(s) at this position`);
                }

                if (mySessIndex < sessionPerformance.length - 1) {
                    const behind = sessionPerformance[mySessIndex + 1];
                    const diff = (studentPerf.session_avg - behind.session_avg).toFixed(1);
                    marksAnalysis.push(`${diff} avg marks ahead of the ${getOrdinal(mySessIndex + 2)} student`);
                }
            }

            studentsData.push({
                student: { ...student, class_name: className },
                subjects: Object.values(subjectMap),
                position,
                marksAnalysis
            });
        }

        const grading = await db.all('SELECT * FROM grading_systems ORDER BY min_score DESC');

        res.render('results/bulk_cumulative', {
            title: `Bulk Cumulative - ${className}`,
            studentsData,
            session,
            school,
            getGrade,
            grading,
            classCount: sessionPerformance.length
        });
    } catch (err) {
        console.error('Bulk Cumulative Error:', err);
        res.status(500).send('Database Error');
    }
};

const getTraitsForm = async (req, res) => {
    const { class_id, term, session } = req.query;
    const user = req.session.staff;

    try {
        let classes;
        if (user.role === 'Admin' || user.role === 'Examination Officer') {
            classes = await db.all('SELECT * FROM classes');
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.* FROM classes c
                JOIN class_assignments ca ON c.id = ca.class_id
                WHERE ca.staff_id = ?
            `, [user.id]);
        }

        let students = [];
        if (class_id) {
            if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
                const isAssigned = await db.get(`
                    SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?
                `, [user.id, class_id]);
                if (!isAssigned) return res.redirect('/results/traits?error=Access Denied');
            }

            students = await db.all(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number,
                       ap.trait_name, ap.score
                FROM students s
                LEFT JOIN affective_psychomotor ap ON s.id = ap.student_id AND ap.term = ? AND ap.session = ?
                WHERE s.current_class_id = ? AND s.status = 'active'
                ORDER BY s.last_name, s.first_name
            `, [term, session, class_id]);
        }

        const studentMap = {};
        students.forEach(row => {
            if (!studentMap[row.id]) {
                studentMap[row.id] = { id: row.id, name: `${row.first_name} ${row.last_name}`, adm: row.admission_number, traits: {} };
            }
            if (row.trait_name) studentMap[row.id].traits[row.trait_name] = row.score;
        });

        res.render('results/traits', {
            title: 'Affective & Psychomotor Traits',
            classes,
            students: Object.values(studentMap),
            filters: { class_id, term, session: session || '2025/2026' },
            traitNames: ['Punctuality', 'Attendance', 'Self Control', 'Neatness', 'Honesty']
        });
    } catch (err) {
        console.error('Traits Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const saveTraits = async (req, res) => {
    const { traits, term, session, class_id } = req.body;
    const user = req.session.staff;

    try {
        if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
            const isAssigned = await db.get(`
                SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?
            `, [user.id, class_id]);
            if (!isAssigned) return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const sql = `
            INSERT INTO affective_psychomotor (student_id, trait_name, score, term, session)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(student_id, trait_name, term, session) DO UPDATE SET score = excluded.score
        `;

        await db.transaction(async () => {
            for (const [student_id, studentTraits] of Object.entries(traits)) {
                for (const [trait_name, score] of Object.entries(studentTraits)) {
                    await db.run(sql, [parseInt(student_id), trait_name, parseInt(score), term, session]);
                }
            }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Save Traits Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};


const approveResults = async (req, res) => {
    const { subject_id, class_id, term, session } = req.body;
    const user = req.session.staff;

    if (user.role !== 'Admin' && user.role !== 'Examination Officer') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        const info = await db.run(`
            UPDATE results 
            SET status = 'approved', approved_by = ?
            WHERE subject_id = ? AND term = ? AND session = ? 
            AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
        `, [user.id, subject_id, term, session, class_id]);
        res.json({ success: true, message: `Approved ${info.changes} results.` });
    } catch (err) {
        console.error('Approve Error:', err);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
};

const lockResults = async (req, res) => {
    const { subject_id, class_id, term, session } = req.body;
    const user = req.session.staff;

    if (user.role !== 'Admin' && user.role !== 'Examination Officer') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        const info = await db.run(`
            UPDATE results 
            SET status = 'locked'
            WHERE subject_id = ? AND term = ? AND session = ? 
            AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
        `, [subject_id, term, session, class_id]);
        res.json({ success: true, message: `Locked ${info.changes} results. Editing is now disabled.` });
    } catch (err) {
        console.error('Lock Error:', err);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
};

const publishBulkResults = async (req, res) => {
    const { class_id, term, session } = req.body;
    const user = req.session.staff;

    if (user.role !== 'Admin' && user.role !== 'Examination Officer') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        let info;
        if (class_id) {
            info = await db.run(`
                UPDATE results 
                SET status = 'published', approved_by = ?
                WHERE term = ? AND session = ? 
                AND student_id IN (SELECT id FROM students WHERE current_class_id = ?)
            `, [user.id, term, session, class_id]);
        } else {
            info = await db.run(`
                UPDATE results 
                SET status = 'published', approved_by = ?
                WHERE term = ? AND session = ? 
            `, [user.id, term, session]);
        }
        res.json({ success: true, message: `Successfully published ${info.changes} result entries across the system.` });
    } catch (err) {
        console.error('Bulk Publish Error:', err);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
};

module.exports = {
    getResultsDashboard,
    getResultManager,
    saveResults,
    getReportCard,
    getCumulativeReport,
    getBulkReport,
    getBulkCumulative,
    getTraitsForm,
    saveTraits,
    getGradingSystem,
    saveResultConfig,
    saveGradingSystem,
    approveResults,
    lockResults,
    publishBulkResults
};
