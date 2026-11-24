const db = require('../utils/db');
const path = require('path');
const { computeResult, getGrade } = require('../utils/resultHelper');
const { logAction } = require('../utils/logger');
const { getEnrolledStudents } = require('../utils/enrollmentHelper');
const { getAvailableSessions, getCurrentSession, getCurrentTerm } = require('../utils/sessionHelper');

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

const getSchoolSettings = async (schoolId) => {
    const sId = schoolId ? Number(schoolId) : null;
    const settings = {};
    if (sId) {
        const settingsArr = await db.all('SELECT key, value FROM settings WHERE school_id = ?', [sId]);
        settingsArr.forEach(s => settings[s.key] = s.value);
    }

    // Load legacy global config as compatibility fallback
    const configArr = await db.all('SELECT key, value FROM result_config').catch(() => []);
    const legacy = {};
    configArr.forEach(c => { legacy[c.key] = c.value; });

    const safeDefaults = { ca_count: '2', ca1_max: '20', ca2_max: '20', exam_max: '60' };
    ['ca_count', 'ca1_max', 'ca2_max', 'exam_max'].forEach(k => {
        const val = settings[`result.${k}`] || settings[k] || legacy[k] || safeDefaults[k];
        settings[k] = val;
        settings[`result.${k}`] = val;
    });

    return settings;
};

// Get result config for a specific class (section-aware, falls back to tenant settings then legacy global)
const getSectionResultConfig = async (class_id, schoolId) => {
    const sId = schoolId ? Number(schoolId) : null;
    const defaults = { ca_count: '2', ca1_max: '20', ca2_max: '20', exam_max: '60' };

    // 1. Check legacy result_config
    const legacyRows = await db.all('SELECT key, value FROM result_config').catch(() => []);
    legacyRows.forEach(r => { if (r.value !== undefined) defaults[r.key] = String(r.value); });

    // 2. Overlay tenant-specific settings[result.*] if schoolId provided
    if (sId) {
        const tenantSettings = await db.all(
            "SELECT key, value FROM settings WHERE school_id = ? AND (key LIKE 'result.%' OR key IN ('ca_count', 'ca1_max', 'ca2_max', 'exam_max'))",
            [sId]
        );
        tenantSettings.forEach(r => {
            const cleanKey = r.key.startsWith('result.') ? r.key.replace('result.', '') : r.key;
            if (r.value !== undefined && r.value !== null) {
                defaults[cleanKey] = String(r.value);
            }
        });
    }

    // 3. Overlay section-specific overrides if class has a section
    if (class_id) {
        const classRow = sId
            ? await db.get('SELECT section_id FROM classes WHERE id = ? AND school_id = ?', [class_id, sId])
            : await db.get('SELECT section_id FROM classes WHERE id = ?', [class_id]);

        if (classRow && classRow.section_id) {
            const sectionRows = await db.all(
                'SELECT key, value FROM section_result_config WHERE section_id = ?',
                [classRow.section_id]
            );
            sectionRows.forEach(r => {
                if (r.value !== undefined && r.value !== null) {
                    defaults[r.key] = String(r.value);
                }
            });
        }
    }

    return defaults;
};

// Get active session/term for a specific class (section-aware, scoped to tenant)
const getSectionAcademicContext = async (class_id, schoolId) => {
    const sId = schoolId ? Number(schoolId) : null;
    if (class_id && sId) {
        const sec = await db.get(`
            SELECT s.current_session, s.current_term 
            FROM sections s 
            JOIN classes c ON c.section_id = s.id 
            WHERE c.id = ? AND c.school_id = ?
        `, [class_id, sId]);
        if (sec && sec.current_session && sec.current_term) {
            return { session: sec.current_session, term: sec.current_term };
        }
    }
    const session = sId ? await getCurrentSession(sId) : null;
    const term = sId ? await getCurrentTerm(sId) : null;
    return {
        session: session || '2024/2025',
        term: term || '1st Term'
    };
};

const getGradingSystem = async (req, res) => {
    const schoolId = req ? (req.schoolId || (req.school ? req.school.id : 1)) : 1;
    try {
        const grading = await db.all('SELECT * FROM grading_systems WHERE school_id = ? ORDER BY min_score DESC', [schoolId]);
        const config = await getSchoolSettings(schoolId);
        const sections = await db.all('SELECT * FROM sections WHERE school_id = ? ORDER BY name', [schoolId]);

        // Load per-section configs
        const sectionConfigs = [];
        for (const sec of sections) {
            const rows = await db.all('SELECT key, value FROM section_result_config WHERE section_id = ?', [sec.id]);
            const cfg = { section_id: sec.id, ca_count: config.ca_count || '2', ca1_max: config.ca1_max || '20', ca2_max: config.ca2_max || '20', exam_max: config.exam_max || '60' };
            rows.forEach(r => { cfg[r.key] = r.value; });
            sectionConfigs.push(cfg);
        }

        if (req && res) {
            res.render('results/setup', {
                title: 'Result Configuration',
                grading,
                config,
                sections,
                sectionConfigs
            });
        }
        return { grading, config };
    } catch (err) {
        console.error('Get Grading Error:', err);
        if (res) res.status(500).send('Database Error');
    }
};

// POST /results/setup/section-config  — save per-section CA weights
const saveResultConfigForSection = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { section_id, ca_count, ca1_max, ca2_max, exam_max } = req.body;
    if (!section_id) return res.status(400).json({ success: false, message: 'section_id required.' });

    try {
        const section = await db.get('SELECT id FROM sections WHERE id = ? AND school_id = ?', [section_id, schoolId]);
        if (!section) return res.status(403).json({ success: false, message: 'Section not found or access denied.' });

        const upsert = db.DB_TYPE === 'postgres'
            ? 'INSERT INTO section_result_config (section_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (section_id, key) DO UPDATE SET value = EXCLUDED.value'
            : 'INSERT INTO section_result_config (section_id, key, value) VALUES (?, ?, ?) ON CONFLICT(section_id, key) DO UPDATE SET value = excluded.value';

        await db.transaction(async () => {
            for (const [key, value] of Object.entries({ ca_count: ca_count || '2', ca1_max, ca2_max, exam_max })) {
                await db.run(upsert, [section_id, key, value]);
            }
        });
        res.json({ success: true, message: 'Section config saved.' });
    } catch (err) {
        console.error('saveResultConfigForSection Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save section config.' });
    }
};

const saveResultConfig = async (req, res) => {
    const schoolId = (req.session && req.session.staff && req.session.staff.school_id)
        ? Number(req.session.staff.school_id)
        : (req.schoolId || (req.school ? req.school.id : 1));
    const { ca1_max, ca2_max, exam_max } = req.body;
    const ca_count = req.body.ca_count || '2';

    try {
        const updates = [
            { key: 'result.ca_count', value: String(ca_count) },
            { key: 'result.ca1_max', value: String(ca1_max) },
            { key: 'result.ca2_max', value: String(ca2_max) },
            { key: 'result.exam_max', value: String(exam_max) }
        ];

        await db.transaction(async () => {
            for (const item of updates) {
                const existing = await db.get(
                    'SELECT key FROM settings WHERE school_id = ? AND key = ?',
                    [schoolId, item.key]
                );
                if (existing) {
                    await db.run(
                        'UPDATE settings SET value = ? WHERE school_id = ? AND key = ?',
                        [item.value, schoolId, item.key]
                    );
                } else {
                    await db.run(
                        'INSERT INTO settings (school_id, key, value) VALUES (?, ?, ?)',
                        [schoolId, item.key, item.value]
                    );
                }
            }
        });
        res.json({ success: true, message: 'Assessment limits updated.' });
    } catch (err) {
        console.error('Save Config Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save config.' });
    }
};

const saveGradingSystem = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { grades } = req.body;
    try {
        const insertSql = `
            INSERT INTO grading_systems (id, school_id, min_score, max_score, grade, remark)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
            min_score=excluded.min_score, max_score=excluded.max_score,
            grade=excluded.grade, remark=excluded.remark, school_id=excluded.school_id
        `;
        const deleteSql = 'DELETE FROM grading_systems WHERE id = ? AND school_id = ?';

        await db.transaction(async () => {
            for (const g of grades) {
                if (g.deleted) {
                    await db.run(deleteSql, [g.id, schoolId]);
                } else {
                    await db.run(insertSql, [g.id || null, schoolId, g.min, g.max, g.grade, g.remark]);
                }
            }
        });

        res.json({ success: true, message: 'Grading system updated.' });
    } catch (err) {
        console.error('Save Grading Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save grading.' });
    }
};




/**
 * Read-only workflow overview for result batches. Results are grouped by their
 * owning class/section, subject, session and term; no student records are changed.
 */
const getResultWorkflowTracking = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const selectedSession = String(req.query.session || '').trim();
    const selectedTerm = String(req.query.term || '').trim();
    const selectedSection = String(req.query.section_id || '').trim();

    try {
        const sessions = await getAvailableSessions(schoolId);
        const sections = await db.all(`
            SELECT DISTINCT sec.id, sec.name
            FROM sections sec
            JOIN classes c ON c.section_id = sec.id AND c.school_id = sec.school_id
            JOIN subject_assignments sa ON sa.class_id = c.id
            WHERE sec.school_id = ?
              AND (
                ? IN ('Admin', 'Examination Officer')
                OR EXISTS (
                    SELECT 1 FROM subject_assignments own
                    WHERE own.class_id = sa.class_id AND own.subject_id = sa.subject_id
                      AND own.session = sa.session AND own.teacher_id = ?
                )
                OR EXISTS (
                    SELECT 1 FROM class_assignments ca
                    WHERE ca.class_id = c.id AND ca.staff_id = ? AND ca.session = sa.session
                )
                OR c.form_teacher_id = ?
              )
            ORDER BY sec.name
        `, [schoolId, user.role, user.id, user.id, user.id]);

        const rows = await db.all(`
            WITH assigned_contexts AS (
                SELECT DISTINCT sa.class_id, sa.subject_id, sa.session
                FROM subject_assignments sa
                JOIN classes c ON c.id = sa.class_id
                JOIN subjects sub ON sub.id = sa.subject_id
                WHERE c.school_id = ? AND sub.school_id = ?
                  AND (? = '' OR sa.session = ?)
                  AND (
                    ? IN ('Admin', 'Examination Officer')
                    OR EXISTS (
                        SELECT 1 FROM subject_assignments own
                        WHERE own.class_id = sa.class_id AND own.subject_id = sa.subject_id
                          AND own.session = sa.session AND own.teacher_id = ?
                    )
                    OR EXISTS (
                        SELECT 1 FROM class_assignments ca
                        WHERE ca.class_id = c.id AND ca.staff_id = ? AND ca.session = sa.session
                    )
                    OR c.form_teacher_id = ?
                  )
            ),
            academic_terms AS (
                SELECT '1st Term' AS term
                UNION ALL SELECT '2nd Term'
                UNION ALL SELECT '3rd Term'
            )
            SELECT
                c.id AS class_id,
                c.name AS class_name,
                sec.id AS section_id,
                COALESCE(sec.name, 'Unassigned section') AS section_name,
                sub.id AS subject_id,
                sub.name AS subject_name,
                a.session,
                period.term,
                COUNT(DISTINCT enrolled.id) AS expected_count,
                COUNT(DISTINCT r.student_id) AS recorded_count,
                COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status, '')) = 'draft' THEN r.student_id END) AS draft_count,
                COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status, '')) = 'submitted' THEN r.student_id END) AS submitted_count,
                COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status, '')) = 'approved' THEN r.student_id END) AS approved_count,
                COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status, '')) = 'locked' THEN r.student_id END) AS locked_count,
                COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status, '')) = 'published' THEN r.student_id END) AS published_count
            FROM assigned_contexts a
            JOIN classes c ON c.id = a.class_id AND c.school_id = ?
            LEFT JOIN sections sec ON sec.id = c.section_id AND sec.school_id = c.school_id
            JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = c.school_id
            CROSS JOIN academic_terms period
            LEFT JOIN student_enrollments se
                ON se.class_id = c.id AND se.session = a.session
            LEFT JOIN students enrolled
                ON enrolled.id = se.student_id AND enrolled.school_id = c.school_id
            LEFT JOIN results r
                ON r.student_id = enrolled.id
                AND r.class_id = c.id
                AND r.subject_id = sub.id
                AND r.session = a.session
                AND r.term = period.term
            WHERE (? = '' OR period.term = ?)
              AND (? = '' OR CAST(sec.id AS TEXT) = ?)
            GROUP BY c.id, c.name, sec.id, sec.name, sub.id, sub.name, a.session, period.term
            ORDER BY sec.name, c.name, sub.name, a.session DESC, period.term
        `, [
            schoolId, schoolId, selectedSession, selectedSession,
            user.role, user.id, user.id, user.id,
            schoolId, selectedTerm, selectedTerm, selectedSection, selectedSection
        ]);

        // Class-first workflow roll-up. A class is considered published only when
        // every assigned subject has a complete published result set for this period.
        const classMap = new Map();
        for (const row of rows) {
            const key = [row.class_id, row.session, row.term].join("|");
            if (!classMap.has(key)) {
                classMap.set(key, {
                    class_id: row.class_id, class_name: row.class_name,
                    section_id: row.section_id, section_name: row.section_name,
                    session: row.session, term: row.term,
                    expected_count: 0, recorded_count: 0, draft_count: 0,
                    submitted_count: 0, approved_count: 0, locked_count: 0,
                    published_count: 0, subjects: []
                });
            }
            const group = classMap.get(key);
            const subject = {
                subject_id: row.subject_id, subject_name: row.subject_name,
                expected_count: Number(row.expected_count || 0),
                recorded_count: Number(row.recorded_count || 0),
                draft_count: Number(row.draft_count || 0),
                submitted_count: Number(row.submitted_count || 0),
                approved_count: Number(row.approved_count || 0),
                locked_count: Number(row.locked_count || 0),
                published_count: Number(row.published_count || 0)
            };
            group.subjects.push(subject);
            for (const field of ['expected_count','recorded_count','draft_count','submitted_count','approved_count','locked_count','published_count']) {
                group[field] += subject[field];
            }
        }
        const classSummaries = [...classMap.values()].map(group => {
            const completePublished = group.subjects.length > 0 && group.subjects.every(subject =>
                subject.expected_count > 0 && subject.published_count === subject.expected_count
            );
            return {
                ...group,
                is_published: completePublished,
                subjects: completePublished ? [] : group.subjects
                    .sort((a,b) => a.subject_name.localeCompare(b.subject_name))
            };
        }).filter(group => group.is_published || group.recorded_count > 0)
          .sort((a,b) => Number(b.is_published)-Number(a.is_published) ||
            a.section_name.localeCompare(b.section_name) || a.class_name.localeCompare(b.class_name));
        const summary = rows.reduce((totals, row) => {
            for (const key of ['expected_count', 'recorded_count', 'draft_count', 'submitted_count', 'approved_count', 'locked_count', 'published_count']) {
                totals[key] += Number(row[key] || 0);
            }
            return totals;
        }, {
            expected_count: 0, recorded_count: 0, draft_count: 0,
            submitted_count: 0, approved_count: 0, locked_count: 0, published_count: 0
        });

        res.render('results/tracking', {
            title: 'Result Workflow Tracking',
            rows,
            classSummaries,
            canManageWorkflow: ['Admin','Examination Officer'].includes(user.role),
            summary,
            sessions,
            sections,
            filters: { session: selectedSession, term: selectedTerm, section_id: selectedSection }
        });
    } catch (err) {
        console.error('Result Workflow Tracking Error:', err);
        res.status(500).send('Unable to load result workflow tracking.');
    }
};

const getResultManager = async (req, res) => {
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const { class_id, subject_id } = req.query;

    // Derive session/term from the selected class's section (falls back to global)
    const sectionCtx = await getSectionAcademicContext(class_id || null, schoolId);
    const settings = await getSchoolSettings(schoolId);
    const activeSession = req.query.session || sectionCtx.session || settings.current_session || '2024/2025';
    const activeTerm = req.query.term || sectionCtx.term || settings.current_term || '1st Term';

    // Section-specific result config (ca weights, exam max)
    const resultConfig = await getSectionResultConfig(class_id || null, schoolId);

    try {
        // Determine subjects to display
        let subjects = [];
        if (class_id) {
            // Verify class belongs to tenant
            const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
            if (!classCheck) return res.redirect('/results?error=Class not found');

            const subjectIdRows = await db.all(`
                SELECT DISTINCT sa.subject_id
                FROM subject_assignments sa
                JOIN subjects sub ON sub.id = sa.subject_id
                WHERE sa.class_id = ? AND sa.session = ? AND sub.school_id = ?
            `, [class_id, activeSession, schoolId]);
            const subjectIds = subjectIdRows.map(r => r.subject_id);
            if (subjectIds.length > 0) {
                const placeholders = subjectIds.map(() => '?').join(',');
                subjects = await db.all(`SELECT * FROM subjects WHERE id IN (${placeholders}) AND school_id = ?`, [...subjectIds, schoolId]);
            } else {
                // Fail closed: an unassigned subject must not be offered for this class.
                subjects = [];
            }
        } else {
            subjects = await db.all('SELECT * FROM subjects WHERE school_id = ?', [schoolId]);
        }

        let classes;
        if (user.role === 'Admin' || user.role === 'Examination Officer') {
            classes = await db.all(`
                SELECT c.*, s.current_session as sec_session, s.current_term as sec_term 
                FROM classes c 
                LEFT JOIN sections s ON c.section_id = s.id
                WHERE c.school_id = ?
            `, [schoolId]);
        } else {
            classes = await db.all(`
                SELECT DISTINCT c.*, s.current_session as sec_session, s.current_term as sec_term 
                FROM classes c
                LEFT JOIN sections s ON c.section_id = s.id
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                WHERE (c.form_teacher_id = ? OR sa.id IS NOT NULL OR ca.id IS NOT NULL)
                  AND c.school_id = ?
            `, [user.id, user.id, user.id, schoolId]);
        }

        let students = [];
        let contextError = null;

        if (class_id && subject_id) {
            if (!subjects.some(subject => String(subject.id) === String(subject_id))) {
                contextError = 'The selected subject is not assigned to this class. Choose a valid class and subject before entering results.';
            }
            if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
                const hasAccess = await db.get(`
                    SELECT 1
                    WHERE EXISTS (
                        SELECT id FROM subject_assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ?
                    ) OR EXISTS (
                        SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?
                    ) OR EXISTS (
                        SELECT id FROM classes WHERE id = ? AND form_teacher_id = ?
                    )
                `, [user.id, class_id, subject_id, user.id, class_id, class_id, user.id]);
                if (!hasAccess) return res.redirect('/results?error=Access Denied to this Subject/Class combination');
            }

            const enrolledStudents = contextError ? [] : await getEnrolledStudents(class_id, activeSession);
            if (enrolledStudents.length > 0) {
                const studentIds = enrolledStudents.map(s => Number(s.id));
                students = await db.all(`
                    SELECT s.id, s.first_name, s.last_name, s.admission_number, s.passport_photo_path,
                           r.ca1, r.ca2, r.exam, r.total, r.grade, r.status, r.teacher_remark
                    FROM students s
                    LEFT JOIN results r ON s.id = r.student_id
                        AND r.subject_id = ? AND r.term = ? AND r.session = ?
                        AND r.class_id = ?
                    WHERE s.id IN (${studentIds.map(() => '?').join(',')})
                      AND s.school_id = ?
                    ORDER BY s.first_name, s.last_name
                `, [subject_id, activeTerm, activeSession, class_id, ...studentIds, schoolId]);
            }
        }

        const grading = await db.all('SELECT * FROM grading_systems WHERE school_id = ? ORDER BY min_score DESC', [schoolId]);
        const availableSessions = await getAvailableSessions(schoolId);

        res.render('results/manager', {
            title: 'Result Management',
            classes,
            subjects,
            students,
            contextError,
            sessions: availableSessions,
            filters: { class_id, subject_id, term: activeTerm, session: activeSession },
            school: settings,
            resultConfig,
            grading,
            canManageResultWorkflow: ['Admin', 'Examination Officer'].includes(user.role)
        });
    } catch (err) {
        console.error('Result Manager Error:', err);
        res.status(500).send('Database Error');
    }
};

const saveResults = async (req, res) => {
    const { results, term, session, subject_id, class_id, status } = req.body; 
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ success: false, message: 'No results to save.' });
    }

    try {
        const normalizedStatus = String(status || 'draft').trim().toLowerCase();
        if (!['draft', 'submitted'].includes(normalizedStatus)) {
            return res.status(400).json({ success: false, message: 'Invalid result status. Only draft and submitted are accepted.' });
        }
        // Validate the complete academic context before any writes.
        if (!class_id || !subject_id || !term || !session || !Array.isArray(results)) {
            return res.status(400).json({ success: false, message: 'Class, subject, term, session, and a results list are required.' });
        }
        const classCheck = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!classCheck) return res.status(403).json({ success: false, message: 'Unauthorized class context.' });

        const subjectCheck = await db.get('SELECT id FROM subjects WHERE id = ? AND school_id = ?', [subject_id, schoolId]);
        if (!subjectCheck) return res.status(403).json({ success: false, message: 'Unauthorized subject context.' });

        const assignmentCheck = await db.get(
            'SELECT id FROM subject_assignments WHERE class_id = ? AND subject_id = ? AND session = ? LIMIT 1',
            [class_id, subject_id, session]
        );
        if (!assignmentCheck) {
            return res.status(400).json({ success: false, message: 'This subject is not assigned to the selected class. No results were saved.' });
        }

        const submittedStudentIds = results.map(item => Number(item && item.student_id));
        if (submittedStudentIds.some(id => !Number.isInteger(id) || id <= 0) ||
            new Set(submittedStudentIds).size !== submittedStudentIds.length) {
            return res.status(400).json({ success: false, message: 'The submitted student list is invalid or contains duplicates. No results were saved.' });
        }

        // The result sheet cohort is the active (or legacy NULL-status) enrollment set.
        const activeCohortRows = await db.all(`
            SELECT DISTINCT st.id
            FROM student_enrollments se
            JOIN students st ON st.id = se.student_id
            WHERE se.class_id = ? AND se.session = ? AND st.school_id = ?
              AND LOWER(COALESCE(st.status, '')) IN ('active', '')
            ORDER BY st.id
        `, [class_id, session, schoolId]);
        const activeStudentIds = activeCohortRows.map(row => Number(row.id));
        const activeStudentSet = new Set(activeStudentIds);
        if (submittedStudentIds.some(id => !activeStudentSet.has(id))) {
            return res.status(400).json({
                success: false,
                message: 'At least one submitted student is not an active enrolment in the selected class and session. No results were saved.'
            });
        }
        if (normalizedStatus === 'submitted' &&
            (submittedStudentIds.length !== activeStudentIds.length ||
             activeStudentIds.some(id => !submittedStudentIds.includes(id)))) {
            return res.status(409).json({
                success: false,
                message: 'Submission requires a result row for every active student in this class and session. Drafts may be saved before the sheet is complete.'
            });
        }

        if (user.role !== 'Admin' && user.role !== 'Examination Officer') {
            const hasAccess = await db.get(`
                SELECT 1
                WHERE (
                    EXISTS (SELECT id FROM subject_assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ?)
                    OR (
                        EXISTS (SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?)
                        AND EXISTS (SELECT id FROM subject_assignments WHERE class_id = ? AND subject_id = ?)
                    )
                    OR (
                        EXISTS (SELECT id FROM classes WHERE id = ? AND form_teacher_id = ?)
                        AND EXISTS (SELECT id FROM subject_assignments WHERE class_id = ? AND subject_id = ?)
                    )
                )
            `, [user.id, class_id, subject_id, user.id, class_id, class_id, subject_id, class_id, user.id, class_id, subject_id]);
            if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized' });

        }

        // Every role must reopen protected records before editing. Admin privileges
        // bypass teaching-assignment checks, not the result publication lock.
        for (const studentId of submittedStudentIds) {
            const existing = await db.get(
                'SELECT status FROM results WHERE student_id = ? AND class_id = ? AND subject_id = ? AND term = ? AND session = ?',
                [studentId, class_id, subject_id, term, session]
            );
            if (existing && ['locked', 'published', 'approved'].includes(String(existing.status || '').trim().toLowerCase())) {
                return res.status(409).json({
                    success: false,
                    message: 'At least one result is approved, locked, or published. An administrator must reopen the subject before any scores can be changed. No results were saved.'
                });
            }
        }

        const sql = `
            INSERT INTO results (student_id, class_id, subject_id, term, session, ca1, ca2, exam, total, grade, teacher_remark, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, class_id, subject_id, term, session) DO UPDATE SET
            ca1=excluded.ca1, ca2=excluded.ca2, exam=excluded.exam, 
            total=excluded.total, grade=excluded.grade, 
            teacher_remark=excluded.teacher_remark, status=excluded.status
            WHERE LOWER(COALESCE(results.status, 'draft')) NOT IN ('approved', 'locked', 'published')
        `;

        const resultConfig = await getSectionResultConfig(class_id, schoolId);
        const caCount = Number(resultConfig.ca_count || 2) > 1 ? 2 : 1;
        const scoreValue = value => value === '' || value === undefined || value === null
            ? null
            : (Number.isFinite(Number(value)) ? Number(value) : NaN);
        const normalizedScores = results.map(item => {
            const ca1 = scoreValue(item.ca1);
            const ca2 = caCount === 1 ? null : scoreValue(item.ca2);
            const exam = scoreValue(item.exam);
            if ([ca1, ca2, exam].some(value => Number.isNaN(value))) {
                throw new Error('Invalid score value. Use a number or leave the assessment blank.');
            }
            const complete = ca1 !== null && exam !== null && (caCount === 1 || ca2 !== null);
            const computed = complete
                ? computeResult(ca1, caCount === 1 ? 0 : ca2, exam)
                : { total: null, grade: null };
            return { ...item, ca1, ca2, exam, total: computed.total, grade: computed.grade };
        });
        // Use the transaction-scoped PostgreSQL client for every write and the
        // verification query. Pool-level calls here would escape the transaction.
        await db.transaction(async (client) => {
            for (const item of normalizedScores) {
                await db.run(sql, [
                    item.student_id, class_id, subject_id, term, session,
                    item.ca1, item.ca2, item.exam,
                    item.total, item.grade, (item.remark || '').trim(), normalizedStatus
                ], client);
            }

            const placeholders = submittedStudentIds.map(() => '?').join(',');
            const persistedRows = await db.all(`
                SELECT student_id, status FROM results
                WHERE class_id = ? AND subject_id = ? AND term = ? AND session = ?
                  AND student_id IN (${placeholders})
            `, [class_id, subject_id, term, session, ...submittedStudentIds], client);
            const persistedByStudent = new Map(persistedRows.map(row => [Number(row.student_id), String(row.status || '').toLowerCase()]));
            if (persistedRows.length !== submittedStudentIds.length ||
                !submittedStudentIds.every(studentId => persistedByStudent.get(studentId) === normalizedStatus)) {
                throw new Error('Result batch verification failed; transaction rolled back.');
            }
        });

        res.json({ success: true, message: `Results ${normalizedStatus === 'submitted' ? 'submitted' : 'saved'} successfully.`, savedCount: submittedStudentIds.length });
    } catch (err) {
        console.error('Save Results Error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to save results.' });
    }
};

const getReportCard = async (req, res) => {
    const { student_id } = req.params;
    const { term, session } = req.query;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);

    try {
        const school = await getSchoolSettings(schoolId);
        const student = await db.get('SELECT * FROM students WHERE id = ? AND school_id = ?', [student_id, schoolId]);
        if (!student) return res.status(404).send('Student not found');

        // Resolve the report class from saved result ownership. Enrollment rows can
        // change after a same-session class move and are not reliable history.
        const { class_id, class_name } = req.query;
        if (!session) return res.status(400).send('Session is required to generate a section-specific report');
        let classObj = null;
        const ownershipSql = `EXISTS (
            SELECT 1 FROM results owned
            WHERE owned.student_id = ? AND owned.class_id = c.id
              AND owned.session = ? AND owned.status IN ('approved', 'published')${req.query.term ? ' AND owned.term = ?' : ''}
        )`;
        const ownershipParams = req.query.term ? [student_id, session, req.query.term] : [student_id, session];
        if (class_id) {
            classObj = await db.get(`
                SELECT c.* FROM classes c
                WHERE c.id = ? AND c.school_id = ? AND ${ownershipSql}
            `, [class_id, schoolId, ...ownershipParams]);
        } else {
            const nameFilter = class_name ? ' AND c.name = ?' : '';
            const matches = await db.all(`
                SELECT c.* FROM classes c
                WHERE c.school_id = ?${nameFilter} AND ${ownershipSql}
                ORDER BY c.id
            `, class_name
                ? [schoolId, class_name, ...ownershipParams]
                : [schoolId, ...ownershipParams]);
            if (matches.length > 1) {
                return res.status(400).send('This student has multiple published class reports for this session. Select the intended class.');
            }
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
             AND r2.session = r.session AND r2.total > r.total AND r2.class_id = ?
             AND r2.status IN ('approved', 'published')) as subject_rank
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

        // Resolve the report class from saved result ownership. Enrollment rows can
        // change after a same-session class move and are not reliable history.
        const { class_id, class_name } = req.query;
        if (!session) return res.status(400).send('Session is required to generate a section-specific report');
        let classObj = null;
        const ownershipSql = `EXISTS (
            SELECT 1 FROM results owned
            WHERE owned.student_id = ? AND owned.class_id = c.id
              AND owned.session = ? AND owned.status IN ('approved', 'published')${req.query.term ? ' AND owned.term = ?' : ''}
        )`;
        const ownershipParams = req.query.term ? [student_id, session, req.query.term] : [student_id, session];
        if (class_id) {
            classObj = await db.get(`
                SELECT c.* FROM classes c
                WHERE c.id = ? AND c.school_id = ? AND ${ownershipSql}
            `, [class_id, schoolId, ...ownershipParams]);
        } else {
            const nameFilter = class_name ? ' AND c.name = ?' : '';
            const matches = await db.all(`
                SELECT c.* FROM classes c
                WHERE c.school_id = ?${nameFilter} AND ${ownershipSql}
                ORDER BY c.id
            `, class_name
                ? [schoolId, class_name, ...ownershipParams]
                : [schoolId, ...ownershipParams]);
            if (matches.length > 1) {
                return res.status(400).send('This student has multiple published class reports for this session. Select the intended class.');
            }
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
                 AND r2.session = r.session AND r2.total > r.total AND r2.class_id = ?
                 AND r2.status IN ('approved', 'published')) as subject_rank
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
    if (!['Admin','Examination Officer'].includes(user.role)) return res.status(403).json({ success:false, message:'Unauthorized' });
    try {
        const owned = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [class_id, schoolId]);
        if (!owned || !subject_id || !term || !session) return res.status(400).json({success:false,message:'Invalid class, subject or academic period.'});
        const expected = await db.get(`SELECT COUNT(DISTINCT se.student_id) AS total FROM student_enrollments se
            JOIN students st ON st.id=se.student_id
            WHERE se.class_id=? AND se.session=? AND st.school_id=?
              AND LOWER(COALESCE(st.status, '')) IN ('active', '')`,[class_id,session,schoolId]);
        const pending = await db.get(`SELECT COUNT(DISTINCT r.student_id) AS total,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status,''))='submitted' THEN r.student_id END) AS submitted
            FROM results r JOIN students st ON st.id=r.student_id
            WHERE r.class_id=? AND r.subject_id=? AND r.term=? AND r.session=? AND st.school_id=?
              AND LOWER(COALESCE(st.status, '')) IN ('active', '')`,[class_id,subject_id,term,session,schoolId]);
        if (!Number(expected.total) || Number(pending.total)!==Number(expected.total) || Number(pending.submitted)!==Number(expected.total))
            return res.status(409).json({success:false,message:'Approval requires every recorded result for this subject to be submitted.'});
        const info = await db.run(`UPDATE results SET status='approved', approved_by=?
            WHERE class_id=? AND subject_id=? AND term=? AND session=? AND LOWER(status)='submitted'`,
            [user.id,class_id,subject_id,term,session]);
        res.json({success:true,message:`Approved ${info.changes} results.`});
    } catch(err){ console.error('Approve Error:',err); res.status(500).json({success:false,message:'Database Error'}); }
};

const lockResults = async (req, res) => {
    const { subject_id, class_id, term, session } = req.body;
    const user = req.session.staff;
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    if (!['Admin','Examination Officer'].includes(user.role)) return res.status(403).json({success:false,message:'Unauthorized'});
    try {
        const owned=await db.get('SELECT id FROM classes WHERE id=? AND school_id=?',[class_id,schoolId]);
        if(!owned || !subject_id || !term || !session) return res.status(400).json({success:false,message:'Invalid class, subject or academic period.'});
        const expected=await db.get(`SELECT COUNT(DISTINCT se.student_id) AS total FROM student_enrollments se
            JOIN students st ON st.id=se.student_id WHERE se.class_id=? AND se.session=? AND st.school_id=?
              AND LOWER(COALESCE(st.status, '')) IN ('active', '')`,[class_id,session,schoolId]);
        const rows=await db.get(`SELECT COUNT(DISTINCT r.student_id) AS total,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status,''))='approved' THEN r.student_id END) AS approved
            FROM results r JOIN students st ON st.id=r.student_id
            WHERE r.class_id=? AND r.subject_id=? AND r.term=? AND r.session=? AND st.school_id=?
              AND LOWER(COALESCE(st.status, '')) IN ('active', '')`,[class_id,subject_id,term,session,schoolId]);
        if(!Number(expected.total) || Number(rows.total)!==Number(expected.total) || Number(rows.approved)!==Number(expected.total))
            return res.status(409).json({success:false,message:'Only fully approved subject results can be locked.'});
        const info=await db.run(`UPDATE results SET status='locked'
            WHERE class_id=? AND subject_id=? AND term=? AND session=? AND LOWER(status)='approved'`,
            [class_id,subject_id,term,session]);
        res.json({success:true,message:`Locked ${info.changes} results.`});
    }catch(err){console.error('Lock Error:',err);res.status(500).json({success:false,message:'Database Error'});}
};

const unlockResults = async (req,res) => {
    const {subject_id,class_id,term,session}=req.body;
    const user=req.session.staff;
    const schoolId=req.schoolId || (req.school ? req.school.id : 1);
    if(!['Admin','Examination Officer'].includes(user.role)) return res.status(403).json({success:false,message:'Unauthorized'});
    try{
        const owned=await db.get('SELECT id FROM classes WHERE id=? AND school_id=?',[class_id,schoolId]);
        if(!owned || !subject_id || !term || !session) return res.status(400).json({success:false,message:'Invalid class, subject or academic period.'});
        const info=await db.run(`UPDATE results SET status='submitted'
            WHERE class_id=? AND subject_id=? AND term=? AND session=?
              AND LOWER(status) IN ('approved','locked','published')`,
            [class_id,subject_id,term,session]);
        if(!Number(info.changes)) return res.status(409).json({success:false,message:'No approved, locked or published results found to reopen.'});
        res.json({success:true,message:`Reopened ${info.changes} results. They are returned to Submitted and can be edited again.`,updatedCount:Number(info.changes),status:'submitted'});
    }catch(err){console.error('Unlock Error:',err);res.status(500).json({success:false,message:'Database Error'});}
};

const publishBulkResults = async (req, res) => {
    const {class_id,term,session}=req.body;
    const user=req.session.staff;
    const schoolId=req.schoolId || (req.school ? req.school.id : 1);
    if(!['Admin','Examination Officer'].includes(user.role)) return res.status(403).json({success:false,message:'Unauthorized'});
    try{
        if(!class_id || !term || !session) return res.status(400).json({success:false,message:'Select a class, term and session.'});
        const owned=await db.get('SELECT id FROM classes WHERE id=? AND school_id=?',[class_id,schoolId]);
        if(!owned) return res.status(403).json({success:false,message:'Unauthorized class'});
        const assigned=await db.all(`SELECT DISTINCT sa.subject_id
            FROM subject_assignments sa JOIN subjects sub ON sub.id=sa.subject_id AND sub.school_id=?
            WHERE sa.class_id=? AND sa.session=?`,[schoolId,class_id,session]);
        if(!assigned.length) return res.status(409).json({success:false,message:'No assigned subjects were found for this class and session.'});
        for(const item of assigned){
            const expected=await db.get(`SELECT COUNT(DISTINCT se.student_id) AS total
                FROM student_enrollments se JOIN students st ON st.id=se.student_id
                WHERE se.class_id=? AND se.session=? AND st.school_id=?
                  AND LOWER(COALESCE(st.status, '')) IN ('active', '')`,[class_id,session,schoolId]);
            const state=await db.get(`SELECT COUNT(DISTINCT r.student_id) AS total,
                COUNT(DISTINCT CASE WHEN LOWER(COALESCE(r.status,'')) IN ('approved','locked','published') THEN r.student_id END) AS ready
                FROM results r JOIN students st ON st.id=r.student_id
                WHERE r.class_id=? AND r.subject_id=? AND r.term=? AND r.session=? AND st.school_id=?
                  AND LOWER(COALESCE(st.status, '')) IN ('active', '')`,
                [class_id,item.subject_id,term,session,schoolId]);
            if(!Number(expected.total) || Number(state.total)!==Number(expected.total) || Number(state.ready)!==Number(expected.total))
                return res.status(409).json({success:false,message:'Publication blocked: every assigned subject must have a complete set of approved or locked results.'});
        }
        const info=await db.run(`UPDATE results SET status='published', approved_by=?
            WHERE class_id=? AND term=? AND session=? AND LOWER(status) IN ('approved','locked')`,
            [user.id,class_id,term,session]);
        res.json({success:true,message:`Published ${info.changes} result entries for the class.`});
    }catch(err){console.error('Bulk Publish Error:',err);res.status(500).json({success:false,message:'Database Error'});}
};

module.exports = {
    getResultsDashboard,
    getResultWorkflowTracking,
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
    unlockResults,
    publishBulkResults,
    getSectionResultConfig,
    getSchoolSettings
};

