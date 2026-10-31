const getReportCard = async (req, res) => {
    const { student_id } = req.params;
    const { term, session } = req.query;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        const school = await getSchoolSettings(schoolId);
        const student = await db.get('SELECT * FROM students WHERE id = ? AND school_id = ?', [student_id, schoolId]);
        if (!student) return res.status(404).send('Student not found');

        const { class_id, class_name } = req.query;
        if (!session || !term) return res.status(400).send('Term and session are required to generate a section-specific report');

        // Resolve historical ownership from published result rows, not mutable enrollment rows.
        const ownership = `EXISTS (SELECT 1 FROM results r
            WHERE r.student_id = ? AND r.class_id = c.id AND r.session = ? AND r.term = ?
              AND r.status IN ('approved', 'published'))`;
        let classObj = null;
        if (class_id) {
            classObj = await db.get(`SELECT c.* FROM classes c
                WHERE c.id = ? AND c.school_id = ? AND ${ownership}`,
                [class_id, schoolId, student_id, session, term]);
        } else {
            const matches = await db.all(`SELECT c.* FROM classes c
                WHERE c.school_id = ? ${class_name ? 'AND c.name = ?' : ''} AND ${ownership}
                ORDER BY c.id`,
                class_name ? [schoolId, class_name, student_id, session, term] : [schoolId, student_id, session, term]);
            if (matches.length > 1) return res.status(400).send('This student has multiple published class reports for this session. Select the intended class.');
            classObj = matches[0] || null;
        }
        if (!classObj) return res.status(404).send('No published results found for the selected class and session');
        
        student.class_name = classObj.name;
        const target_class_id = classObj.id;

        const resultConfig = await getSectionResultConfig(target_class_id, schoolId);

        const results = await db.all(`
            SELECT r.*, s.name as subject_name,
            (SELECT COUNT(*) + 1 FROM results r2 
             WHERE r2.subject_id = r.subject_id AND r2.term = r.term 
             AND r2.session = r.session AND r2.total > r.total AND r2.class_id = ? AND r2.status IN ('approved', 'published')
              ) as subject_rank
            FROM results r
            JOIN subjects s ON r.subject_id = s.id
            WHERE r.student_id = ? AND r.term = ? AND r.session = ?
              AND r.class_id = ? AND r.status IN ('approved', 'published')
        `, [target_class_id, student_id, term, session, target_class_id]);

        const classPerformance = await db.all(`
            SELECT r.student_id, SUM(r.total) as student_total
            FROM results r
            WHERE r.term = ? AND r.session = ? AND r.class_id = ?
              AND r.status IN ('approved', 'published')
            GROUP BY r.student_id
            ORDER BY student_total DESC
        `, [term, session, target_class_id]);

        const studentPerf = classPerformance.find(p => p.student_id == student_id);
        const position = studentPerf ? classPerformance.indexOf(studentPerf) + 1 : 0;
        const classCount = classPerformance.length;

        // Attendance
        const attendance = await db.get(`
            SELECT COUNT(*) as present_count FROM attendance 
            WHERE student_id = ? AND class_id = ? AND status = 'Present' AND term = ? AND session = ?
        `, [student_id, target_class_id, term, session]) || { present_count: 0 };

        // Traits
        const traitRows = await db.all(`
            SELECT trait_name, score FROM affective_psychomotor
            WHERE student_id = ? AND class_id = ? AND term = ? AND session = ?
        `, [student_id, target_class_id, term, session]) || [];
        const traits = {};
        traitRows.forEach(t => traits[t.trait_name] = t.score);

        const grading = await db.all('SELECT * FROM grading_systems WHERE school_id = ? ORDER BY min_score DESC', [schoolId]);

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
            caCount: resultConfig.ca_count || 2,
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        const school = await getSchoolSettings(schoolId);
        const student = await db.get('SELECT * FROM students WHERE id = ? AND school_id = ?', [student_id, schoolId]);
        if (!student) return res.status(404).send('Student not found');

        const { class_id, class_name } = req.query;
        if (!session) return res.status(400).send('Session is required to generate a section-specific report');

        // Resolve historical ownership from published result rows, not mutable enrollment rows.
        const ownership = `EXISTS (SELECT 1 FROM results r
            WHERE r.student_id = ? AND r.class_id = c.id AND r.session = ?
              AND r.status IN ('approved', 'published'))`;
        let classObj = null;
        if (class_id) {
            classObj = await db.get(`SELECT c.* FROM classes c
                WHERE c.id = ? AND c.school_id = ? AND ${ownership}`,
                [class_id, schoolId, student_id, session]);
        } else {
            const matches = await db.all(`SELECT c.* FROM classes c
                WHERE c.school_id = ? ${class_name ? 'AND c.name = ?' : ''} AND ${ownership}
                ORDER BY c.id`,
                class_name ? [schoolId, class_name, student_id, session] : [schoolId, student_id, session]);
            if (matches.length > 1) return res.status(400).send('This student has multiple published class reports for this session. Select the intended class.');
            classObj = matches[0] || null;
        }
        if (!classObj) return res.status(404).send('No published results found for the selected class and session');
        
        student.class_name = classObj.name;
        const target_class_id = classObj.id;

        const rawResults = await db.all(`
            SELECT r.*, s.name as subject_name
            FROM results r
            JOIN subjects s ON r.subject_id = s.id
            WHERE r.student_id = ? AND r.session = ?
              AND r.class_id = ? AND r.status IN ('approved', 'published')
        `, [student_id, session, target_class_id]);

        const subjectMap = {};
        rawResults.forEach(r => {
            if (!subjectMap[r.subject_id]) {
                subjectMap[r.subject_id] = { name: r.subject_name, terms: {}, avg: 0 };
            }
            subjectMap[r.subject_id].terms[r.term] = r.total;
        });

        const subjects = Object.values(subjectMap);

        const sessionPerformance = await db.all(`
            SELECT r.student_id, AVG(r.total) as session_avg
            FROM results r
            WHERE r.session = ? AND r.class_id = ?
              AND r.status IN ('approved', 'published')
            GROUP BY r.student_id
            ORDER BY session_avg DESC
        `, [session, target_class_id]);

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

        const grading = await db.all('SELECT * FROM grading_systems WHERE school_id = ? ORDER BY min_score DESC', [schoolId]);

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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        if (!class_id || !term || !session) {
            let classes;
            if (user.role === 'Admin' || user.role === 'Examination Officer') {
                classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name', [schoolId]);
            } else {
                classes = await db.all(`
                    SELECT DISTINCT c.* FROM classes c
                    JOIN class_assignments ca ON c.id = ca.class_id
                    WHERE ca.staff_id = ? AND c.school_id = ?
                    ORDER BY c.name
                `, [user.id, schoolId]);
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

        const school = await getSchoolSettings(schoolId);
        const resultConfig = await getSectionResultConfig(class_id, schoolId);
        const students = await getEnrolledStudents(class_id, session);
        const classInfo = await db.get('SELECT name FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classInfo) return res.redirect('/results/bulk?error=Class not found');
        const className = classInfo.name;

        const classPerformance = await db.all(`
            SELECT student_id, SUM(total) as student_total
            FROM results
            WHERE term = ? AND session = ? AND class_id = ?
              AND status IN ('approved', 'published')
            GROUP BY student_id
            ORDER BY student_total DESC
        `, [term, session, class_id]);

        const studentsData = [];
        for (const student of students) {
            const results = await db.all(`
                SELECT r.*, s.name as subject_name,
                (SELECT COUNT(*) + 1 FROM results r2
                 WHERE r2.subject_id = r.subject_id AND r2.term = r.term
                 AND r2.session = r.session AND r2.total > r.total AND r2.class_id = ? AND r2.status IN ('approved', 'published')
                 ) as subject_rank
                FROM results r
                JOIN subjects s ON r.subject_id = s.id
                WHERE r.student_id = ? AND r.term = ? AND r.session = ?
                  AND r.class_id = ? AND r.status IN ('approved', 'published')
            `, [class_id, student.id, term, session, class_id]);

            const studentPerf = classPerformance.find(p => p.student_id == student.id);
            const position = studentPerf ? classPerformance.indexOf(studentPerf) + 1 : 0;

            const traitRows = await db.all(`
                SELECT trait_name, score FROM affective_psychomotor
                WHERE student_id = ? AND class_id = ? AND term = ? AND session = ?
            `, [student.id, class_id, term, session]);
            const traits = {};
            traitRows.forEach(t => traits[t.trait_name] = t.score);

            const attendance = await db.get(`
                SELECT COUNT(*) as present_count FROM attendance
                WHERE student_id = ? AND class_id = ? AND status = 'Present' AND term = ? AND session = ?
            `, [student.id, class_id, term, session]) || { present_count: 0 };

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

        const grading = await db.all('SELECT * FROM grading_systems WHERE school_id = ? ORDER BY min_score DESC', [schoolId]);

        res.render('results/bulk_report', {
            title: `Bulk Report - ${className}`,
            studentsData,
            term,
            session,
            school,
            grading,
            classCount: classPerformance.length,
            caCount: resultConfig.ca_count || 2
        });
    } catch (err) {
        console.error('Bulk Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getBulkCumulative = async (req, res) => {
    const { class_id, session } = req.query;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const school = await getSchoolSettings(schoolId);
        const students = await getEnrolledStudents(class_id, session);
        const classInfo = await db.get('SELECT name FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classInfo) return res.redirect('/results/bulk?error=Class not found');
        const className = classInfo.name;

        const sessionPerformance = await db.all(`
            SELECT student_id, AVG(total) as session_avg
            FROM results
            WHERE session = ? AND class_id = ?
              AND status IN ('approved', 'published')
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
                  AND r.class_id = ? AND r.status IN ('approved', 'published')
            `, [student.id, session, class_id]);

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

        const grading = await db.all('SELECT * FROM grading_systems WHERE school_id = ? ORDER BY min_score DESC', [schoolId]);

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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        let classes;
        if (user.role === 'Admin' || user.role === 'Examination Officer') {
            classes = await db.all('SELECT * FROM classes WHERE school_id = ? ORDER BY name', [schoolId]);
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.* FROM classes c
                JOIN class_assignments ca ON c.id = ca.class_id
                WHERE ca.staff_id = ? AND c.school_id = ?
                ORDER BY c.name
            `, [user.id, schoolId]);
        }

        let students = [];
        if (class_id) {
            const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
            if (!classCheck) return res.redirect('/results/traits?error=Class not found');

            if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
                const isAssigned = await db.get(`
                    SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?
                `, [user.id, class_id]);
                if (!isAssigned) return res.redirect('/results/traits?error=Access Denied');
            }

            const enrolledForTraits = await getEnrolledStudents(class_id, session);
            if (enrolledForTraits.length > 0) {
                const traitIds = enrolledForTraits.map(s => Number(s.id));
                students = await db.all(`
                    SELECT s.id, s.first_name, s.last_name, s.admission_number,
                           ap.trait_name, ap.score
                    FROM students s
                    LEFT JOIN affective_psychomotor ap
                        ON s.id = ap.student_id
                       AND ap.class_id = ?
                       AND ap.term = ?
                       AND ap.session = ?
                    WHERE s.id IN (${traitIds.map(() => '?').join(',')}) AND s.school_id = ?
                    ORDER BY s.first_name, s.last_name
                `, [class_id, term, session, ...traitIds, schoolId]);
            }
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classCheck) return res.status(403).json({ success: false, message: 'Unauthorized class context' });

        if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
            const isAssigned = await db.get(`
                SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?
            `, [user.id, class_id]);
            if (!isAssigned) return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        if (!class_id || !term || !session || !traits || typeof traits !== 'object' || Array.isArray(traits)) {
            return res.status(400).json({ success: false, message: 'Class, term, session, and trait assessments are required.' });
        }

        // Validate the complete submitted cohort before writing any trait rows.
        for (const [student_id, studentTraits] of Object.entries(traits)) {
            const studentId = Number(student_id);
            if (!Number.isInteger(studentId) || studentId <= 0 || !studentTraits || typeof studentTraits !== 'object') {
                return res.status(400).json({ success: false, message: 'Invalid trait assessment payload. No assessments were saved.' });
            }
            const studentCheck = await db.get('SELECT id FROM students WHERE id = ? AND school_id = ?', [studentId, schoolId]);
            const enrollment = await db.get(
                'SELECT student_id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ? LIMIT 1',
                [studentId, class_id, session]
            );
            if (!studentCheck || !enrollment) {
                return res.status(400).json({ success: false, message: 'Every assessed student must be enrolled in the selected class for this session. No assessments were saved.' });
            }
            for (const score of Object.values(studentTraits)) {
                if (!Number.isInteger(Number(score)) || Number(score) < 1 || Number(score) > 5) {
                    return res.status(400).json({ success: false, message: 'Trait scores must be whole numbers from 1 to 5. No assessments were saved.' });
                }
            }
        }

        const sql = `
            INSERT INTO affective_psychomotor (student_id, class_id, trait_name, score, term, session)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, class_id, trait_name, term, session) DO UPDATE SET score = excluded.score
        `;

        await db.transaction(async () => {
            for (const [student_id, studentTraits] of Object.entries(traits)) {
                for (const [trait_name, score] of Object.entries(studentTraits)) {
                    await db.run(sql, [Number(student_id), class_id, trait_name, Number(score), term, session]);
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
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (user.role !== 'Admin' && user.role !== 'Examination Officer') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classCheck) return res.status(403).json({ success: false, message: 'Unauthorized class' });

        const info = await db.run(`
            UPDATE results
            SET status = 'approved', approved_by = ?
            WHERE class_id = ? AND subject_id = ? AND term = ? AND session = ?
        `, [user.id, class_id, subject_id, term, session]);
        res.json({ success: true, message: `Approved ${info.changes} results.` });
    } catch (err) {
        console.error('Approve Error:', err);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
};

const lockResults = async (req, res) => {
    const { subject_id, class_id, term, session } = req.body;
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (user.role !== 'Admin' && user.role !== 'Examination Officer') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classCheck) return res.status(403).json({ success: false, message: 'Unauthorized class' });

        const info = await db.run(`
            UPDATE results
            SET status = 'locked'
            WHERE class_id = ? AND subject_id = ? AND term = ? AND session = ?
        `, [class_id, subject_id, term, session]);
        res.json({ success: true, message: `Locked ${info.changes} results. Editing is now disabled.` });
    } catch (err) {
        console.error('Lock Error:', err);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
};

const publishBulkResults = async (req, res) => {
    const { class_id, term, session } = req.body;
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (user.role !== 'Admin' && user.role !== 'Examination Officer') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        if (!class_id || !term || !session) {
            return res.status(400).json({
                success: false,
                message: 'Select a class, term, and session. School-wide publication is disabled until it has a separate, explicit workflow.'
            });
        }
        const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classCheck) return res.status(403).json({ success: false, message: 'Unauthorized class' });

        const info = await db.run(`
            UPDATE results
            SET status = 'published', approved_by = ?
            WHERE class_id = ? AND term = ? AND session = ?
        `, [user.id, class_id, term, session]);
        res.json({ success: true, message: `Successfully published ${info.changes} result entries for the selected class.` });
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
    saveResultConfigForSection,
    saveGradingSystem,
    approveResults,
    lockResults,
    publishBulkResults,
    getSectionResultConfig,
    getSchoolSettings
};

