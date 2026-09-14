/**
 * tests/phase3-session-tenant.test.js
 * 
 * Comprehensive Phase 3 Checkpoint 2 Regression Test Suite:
 * - Group A: Session / Term Infrastructure & Multi-Tenant Academic Isolation
 * - Group B: Tenant-Scoped Result Configuration & Section Overrides
 * - Group C: Student Portal Tenant Scoping & Context Resolution
 * - Group D: Dynamic Session / Term Availability & Settings Middleware
 * - Group E: Defensive Domain Scoping & IDOR Protections
 */

const assert = require('assert');
const path = require('path');
const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');
const resultController = require('../controllers/resultController');
const enrollmentHelper = require('../utils/enrollmentHelper');
const settingsMiddleware = require('../middleware/settingsMiddleware');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { isStudentAuthenticated } = require('../middleware/studentAuthMiddleware');

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
    try {
        await fn();
        testsPassed++;
        console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
        testsFailed++;
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`       ${err.message}`);
    }
}

async function runPhase3Tests() {
    console.log('============================================================');
    console.log('🧪 PHASE 3 CHECKPOINT 2 — REGRESSION TEST SUITE');
    console.log('============================================================\n');

    let schoolAId, schoolBId, schoolUnconfId;
    let studentAId, studentBId;
    let classAId, classBId;
    let sectionAId, sectionBId;
    let subjectAId, subjectBId;

    try {
        const now = Date.now();

        // ------------------------------------------------------------
        // Setup Isolated Test Fixtures
        // ------------------------------------------------------------
        const resA = await db.run(
            "INSERT INTO schools (name, slug, current_session, current_term, status) VALUES (?, ?, ?, ?, 'active')",
            [`P3 School A ${now}`, `p3-school-a-${now}`, '2025/2026', '1st Term']
        );
        schoolAId = Number(resA.lastInsertRowid);

        const resB = await db.run(
            "INSERT INTO schools (name, slug, current_session, current_term, status) VALUES (?, ?, ?, ?, 'active')",
            [`P3 School B ${now}`, `p3-school-b-${now}`, '2026/2027', '2nd Term']
        );
        schoolBId = Number(resB.lastInsertRowid);

        const resUnconf = await db.run(
            "INSERT INTO schools (name, slug, current_session, current_term, status) VALUES (?, ?, NULL, NULL, 'active')",
            [`P3 School Unconf ${now}`, `p3-school-u-${now}`]
        );
        schoolUnconfId = Number(resUnconf.lastInsertRowid);

        // Sections
        const sA = await db.run("INSERT INTO sections (name, current_session, current_term, school_id) VALUES (?, '2025/2026', '1st Term', ?)", [`SecA_${now}`, schoolAId]);
        sectionAId = Number(sA.lastInsertRowid);

        const sB = await db.run("INSERT INTO sections (name, current_session, current_term, school_id) VALUES (?, '2028/2029', '3rd Term', ?)", [`SecB_${now}`, schoolBId]);
        sectionBId = Number(sB.lastInsertRowid);

        // Classes
        const cA = await db.run("INSERT INTO classes (name, section_id, school_id) VALUES (?, ?, ?)", [`ClsA_${now}`, sectionAId, schoolAId]);
        classAId = Number(cA.lastInsertRowid);

        const cB = await db.run("INSERT INTO classes (name, section_id, school_id) VALUES (?, ?, ?)", [`ClsB_${now}`, sectionBId, schoolBId]);
        classBId = Number(cB.lastInsertRowid);

        // Subjects
        const subA = await db.run("INSERT INTO subjects (name, code, school_id) VALUES (?, ?, ?)", [`SubA_${now}`, `SA${now}`, schoolAId]);
        subjectAId = Number(subA.lastInsertRowid);

        const subB = await db.run("INSERT INTO subjects (name, code, school_id) VALUES (?, ?, ?)", [`SubB_${now}`, `SB${now}`, schoolBId]);
        subjectBId = Number(subB.lastInsertRowid);

        // Students
        const studA = await db.run(
            "INSERT INTO students (first_name, last_name, gender, admission_number, current_class_id, school_id, status) VALUES ('Alice', 'A', 'Female', ?, ?, ?, 'active')",
            [`P3-ADM-A-${now}`, classAId, schoolAId]
        );
        studentAId = Number(studA.lastInsertRowid);

        const studB = await db.run(
            "INSERT INTO students (first_name, last_name, gender, admission_number, current_class_id, school_id, status) VALUES ('Bob', 'B', 'Male', ?, ?, ?, 'active')",
            [`P3-ADM-B-${now}`, classBId, schoolBId]
        );
        studentBId = Number(studB.lastInsertRowid);

        // Historical enrollments & results
        await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, '2023/2024')", [studentAId, classAId]);
        await db.run("INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, '2029/2030')", [studentBId, classBId]);

        await db.run("INSERT INTO results (student_id, subject_id, session, term, ca1, ca2, exam, total) VALUES (?, ?, '2023/2024', '1st Term', 10, 10, 50, 70)", [studentAId, subjectAId]);
        await db.run("INSERT INTO results (student_id, subject_id, session, term, ca1, ca2, exam, total) VALUES (?, ?, '2029/2030', '2nd Term', 15, 15, 60, 90)", [studentBId, subjectBId]);

        // Settings
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_session', '2025/2026')", [schoolAId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_term', '1st Term')", [schoolAId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_session', '2026/2027')", [schoolBId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_term', '2nd Term')", [schoolBId]);

        // ------------------------------------------------------------
        // Block 1: Group A — Session & Term Infrastructure
        // ------------------------------------------------------------
        console.log('--- Block 1: Session & Term Isolation ---');

        await test('1.1 School A current session resolves to 2025/2026', async () => {
            const sess = await sessionHelper.getCurrentSession(schoolAId);
            assert.strictEqual(sess, '2025/2026');
        });

        await test('1.2 School B current session resolves to 2026/2027', async () => {
            const sess = await sessionHelper.getCurrentSession(schoolBId);
            assert.strictEqual(sess, '2026/2027');
        });

        await test('1.3 School A current term resolves to 1st Term', async () => {
            const term = await sessionHelper.getCurrentTerm(schoolAId);
            assert.strictEqual(term, '1st Term');
        });

        await test('1.4 School B current term resolves to 2nd Term', async () => {
            const term = await sessionHelper.getCurrentTerm(schoolBId);
            assert.strictEqual(term, '2nd Term');
        });

        await test('1.5 School A available sessions do not leak School B sessions (2026/2027, 2028/2029, 2029/2030)', async () => {
            const sessionsA = await sessionHelper.getAvailableSessions(schoolAId);
            assert(sessionsA.includes('2025/2026'), 'School A must contain 2025/2026');
            assert(sessionsA.includes('2023/2024'), 'School A must contain historical 2023/2024');
            assert(!sessionsA.includes('2026/2027'), 'School A must NOT contain School B current 2026/2027');
            assert(!sessionsA.includes('2028/2029'), 'School A must NOT contain School B section session 2028/2029');
            assert(!sessionsA.includes('2029/2030'), 'School A must NOT contain School B historical 2029/2030');
        });

        await test('1.6 School B available sessions do not leak School A sessions (2023/2024, 2025/2026)', async () => {
            const sessionsB = await sessionHelper.getAvailableSessions(schoolBId);
            assert(sessionsB.includes('2026/2027'), 'School B must contain 2026/2027');
            assert(sessionsB.includes('2028/2029'), 'School B must contain 2028/2029');
            assert(sessionsB.includes('2029/2030'), 'School B must contain 2029/2030');
            assert(!sessionsB.includes('2023/2024'), 'School B must NOT contain School A 2023/2024');
            assert(!sessionsB.includes('2025/2026'), 'School B must NOT contain School A 2025/2026');
        });

        await test('1.7 Unconfigured school returns null/empty and does NOT fall back to Al-Jaleel', async () => {
            const sess = await sessionHelper.getCurrentSession(schoolUnconfId);
            assert.strictEqual(sess, null);
            const term = await sessionHelper.getCurrentTerm(schoolUnconfId);
            assert.strictEqual(term, null);
            const list = await sessionHelper.getAvailableSessions(schoolUnconfId);
            assert.deepStrictEqual(list, []);
        });

        await test('1.8 Class academic context isolates across tenant boundary', async () => {
            const ctxB = await sessionHelper.getAcademicContext(classBId, schoolBId);
            assert.strictEqual(ctxB.session, '2028/2029', 'Class B should resolve to Section B override');
            const ctxCross = await sessionHelper.getAcademicContext(classBId, schoolAId);
            assert.strictEqual(ctxCross.session, '2025/2026', 'Cross tenant lookup falls back to School A, not Class B');
        });

        // ------------------------------------------------------------
        // Block 2: Group B — Result Configuration
        // ------------------------------------------------------------
        console.log('\n--- Block 2: Result Configuration ---');

        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'result.ca1_max', '18')", [schoolAId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'result.ca2_max', '18')", [schoolAId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'result.exam_max', '64')", [schoolAId]);

        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'result.ca1_max', '25')", [schoolBId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'result.ca2_max', '0')", [schoolBId]);
        await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'result.exam_max', '75')", [schoolBId]);

        await test('2.1 School A resolves its own result configuration', async () => {
            const cfgA = await resultController.getSchoolSettings(schoolAId);
            assert.strictEqual(cfgA.ca1_max, '18');
            assert.strictEqual(cfgA.ca2_max, '18');
            assert.strictEqual(cfgA.exam_max, '64');
        });

        await test('2.2 School B resolves its own result configuration', async () => {
            const cfgB = await resultController.getSchoolSettings(schoolBId);
            assert.strictEqual(cfgB.ca1_max, '25');
            assert.strictEqual(cfgB.ca2_max, '0');
            assert.strictEqual(cfgB.exam_max, '75');
        });

        await test('2.3 Saving result config for School B does not mutate School A', async () => {
            const mockReq = {
                session: { staff: { id: 101, role: 'Admin', school_id: schoolBId } },
                schoolId: schoolBId,
                body: { ca_count: '2', ca1_max: '22', ca2_max: '22', exam_max: '56' }
            };
            const mockRes = { json: () => {} };
            await resultController.saveResultConfig(mockReq, mockRes);

            const cfgA = await resultController.getSchoolSettings(schoolAId);
            assert.strictEqual(cfgA.ca1_max, '18', 'School A ca1_max must remain unchanged');
            assert.strictEqual(cfgA.exam_max, '64', 'School A exam_max must remain unchanged');

            const cfgB = await resultController.getSchoolSettings(schoolBId);
            assert.strictEqual(cfgB.ca1_max, '22', 'School B ca1_max must be updated');
        });

        await test('2.4 Section result configuration overrides tenant settings for class', async () => {
            await db.run("INSERT INTO section_result_config (section_id, key, value) VALUES (?, 'ca1_max', '30')", [sectionBId]);
            const secCfg = await resultController.getSectionResultConfig(classBId, schoolBId);
            assert.strictEqual(secCfg.ca1_max, '30');
            assert.strictEqual(secCfg.exam_max, '56', 'Non-overridden field falls back to School B tenant setting');
        });

        await test('2.5 Legacy result_config table remains intact and uncorrupted', async () => {
            const rows = await db.all('SELECT * FROM result_config');
            assert(rows.length > 0, 'result_config table must exist and contain rows');
        });

        // ------------------------------------------------------------
        // Block 3: Group C — Student Portal Context
        // ------------------------------------------------------------
        console.log('\n--- Block 3: Student Portal Context ---');

        await test('3.1 isStudentAuthenticated fails closed when student session lacks school_id and record is missing', async () => {
            let status = null;
            let sent = null;
            const req = {
                session: { student: { id: 999999 } },
                schoolId: schoolAId
            };
            const res = {
                status: (s) => { status = s; return { send: (m) => { sent = m; } }; },
                redirect: () => {}
            };
            let nextCalled = false;
            await isStudentAuthenticated(req, res, () => { nextCalled = true; });
            assert.strictEqual(status, 403);
            assert(!nextCalled, 'next() must not be called when student tenant cannot be established');
        });

        await test('3.2 isStudentAuthenticated recovers missing school_id from DB for authenticated student', async () => {
            const req = {
                session: { student: { id: studentAId } },
                schoolId: schoolAId
            };
            let nextCalled = false;
            await isStudentAuthenticated(req, {}, () => { nextCalled = true; });
            assert(nextCalled, 'next() should be called after recovering student tenant');
            assert.strictEqual(req.session.student.school_id, schoolAId);
            assert.strictEqual(req.schoolId, schoolAId);
        });

        await test('3.3 Grading systems query is tenant-scoped', async () => {
            await db.run("INSERT INTO grading_systems (min_score, max_score, grade, remark, school_id) VALUES (85, 100, 'A*', 'Exceptional', ?)", [schoolAId]);
            await db.run("INSERT INTO grading_systems (min_score, max_score, grade, remark, school_id) VALUES (90, 100, 'Distinction', 'Superb', ?)", [schoolBId]);

            const gradesA = await db.all("SELECT * FROM grading_systems WHERE school_id = ?", [schoolAId]);
            const gradesB = await db.all("SELECT * FROM grading_systems WHERE school_id = ?", [schoolBId]);

            assert(gradesA.some(g => g.grade === 'A*'), 'School A has A*');
            assert(!gradesA.some(g => g.grade === 'Distinction'), 'School A must not leak School B grade');
            assert(gradesB.some(g => g.grade === 'Distinction'), 'School B has Distinction');
            assert(!gradesB.some(g => g.grade === 'A*'), 'School B must not leak School A grade');
        });

        // ------------------------------------------------------------
        // Block 4: Group D — Dynamic Session / Term UI
        // ------------------------------------------------------------
        console.log('\n--- Block 4: Dynamic Session / Term UI ---');

        await test('4.1 settingsMiddleware exposes tenant current_session and current_term in res.locals', async () => {
            const reqA = { session: { staff: { id: 1, role: 'Admin', school_id: schoolAId } } };
            const resA = { locals: {} };
            await settingsMiddleware(reqA, resA, () => {});
            assert.strictEqual(resA.locals.current_session, '2025/2026');
            assert.strictEqual(resA.locals.current_term, '1st Term');

            const reqB = { session: { staff: { id: 2, role: 'Admin', school_id: schoolBId } } };
            const resB = { locals: {} };
            await settingsMiddleware(reqB, resB, () => {});
            assert.strictEqual(resB.locals.current_session, '2026/2027');
            assert.strictEqual(resB.locals.current_term, '2nd Term');
        });

        await test('4.2 settingsMiddleware available_sessions are strictly scoped to requesting tenant', async () => {
            const reqA = { session: { staff: { id: 1, role: 'Admin', school_id: schoolAId } } };
            const resA = { locals: {} };
            await settingsMiddleware(reqA, resA, () => {});
            assert(resA.locals.available_sessions.includes('2025/2026'));
            assert(!resA.locals.available_sessions.includes('2026/2027'));

            const reqB = { session: { staff: { id: 2, role: 'Admin', school_id: schoolBId } } };
            const resB = { locals: {} };
            await settingsMiddleware(reqB, resB, () => {});
            assert(resB.locals.available_sessions.includes('2026/2027'));
            assert(!resB.locals.available_sessions.includes('2025/2026'));
        });

        // ------------------------------------------------------------
        // Block 5: Group E — Defensive Scoping & IDOR Guards
        // ------------------------------------------------------------
        console.log('\n--- Block 5: Defensive Scoping & Invariants ---');

        await test('5.1 isAuthenticated fails closed when staff session lacks school_id', async () => {
            let status = null;
            const req = { session: { staff: { id: 1, role: 'Admin' } } };
            const res = {
                status: (s) => { status = s; return { send: () => {} }; },
                redirect: () => {}
            };
            let nextCalled = false;
            isAuthenticated(req, res, () => { nextCalled = true; });
            assert.strictEqual(status, 403);
            assert(!nextCalled);
        });

        await test('5.2 Zero OR school_id IS NULL in all controllers', async () => {
            const fs = require('fs');
            const cDir = path.resolve(__dirname, '../controllers');
            const files = fs.readdirSync(cDir).filter(f => f.endsWith('.js'));
            const violations = [];
            for (const f of files) {
                const content = fs.readFileSync(path.join(cDir, f), 'utf8');
                if (/school_id\s+IS\s+NULL/i.test(content)) {
                    violations.push(f);
                }
            }
            assert.deepStrictEqual(violations, [], `Violations found in: ${violations.join(', ')}`);
        });

        await test('5.3 Zero schoolId = 1 default parameters in attendanceController or resultController', async () => {
            const fs = require('fs');
            const att = fs.readFileSync(path.resolve(__dirname, '../controllers/attendanceController.js'), 'utf8');
            const resCtrl = fs.readFileSync(path.resolve(__dirname, '../controllers/resultController.js'), 'utf8');
            assert(!/schoolId\s*=\s*1\b/.test(att), 'Found schoolId = 1 default in attendanceController');
            assert(!/schoolId\s*=\s*1\b/.test(resCtrl), 'Found schoolId = 1 default in resultController');
        });

        console.log('\n============================================================');
        console.log(`Phase 3 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
        console.log('============================================================');

        if (testsFailed > 0) {
            process.exit(1);
        }
    } finally {
        // Cleanup all test fixtures
        if (studentAId) {
            await db.run("DELETE FROM results WHERE student_id = ?", [studentAId]);
            await db.run("DELETE FROM student_enrollments WHERE student_id = ?", [studentAId]);
            await db.run("DELETE FROM students WHERE id = ?", [studentAId]);
        }
        if (studentBId) {
            await db.run("DELETE FROM results WHERE student_id = ?", [studentBId]);
            await db.run("DELETE FROM student_enrollments WHERE student_id = ?", [studentBId]);
            await db.run("DELETE FROM students WHERE id = ?", [studentBId]);
        }
        if (classAId) await db.run("DELETE FROM classes WHERE id = ?", [classAId]);
        if (classBId) await db.run("DELETE FROM classes WHERE id = ?", [classBId]);
        if (sectionAId) await db.run("DELETE FROM sections WHERE id = ?", [sectionAId]);
        if (sectionBId) {
            await db.run("DELETE FROM section_result_config WHERE section_id = ?", [sectionBId]);
            await db.run("DELETE FROM sections WHERE id = ?", [sectionBId]);
        }
        if (subjectAId) await db.run("DELETE FROM subjects WHERE id = ?", [subjectAId]);
        if (subjectBId) await db.run("DELETE FROM subjects WHERE id = ?", [subjectBId]);
        if (schoolAId) {
            await db.run("DELETE FROM grading_systems WHERE school_id = ?", [schoolAId]);
            await db.run("DELETE FROM settings WHERE school_id = ?", [schoolAId]);
            await db.run("DELETE FROM schools WHERE id = ?", [schoolAId]);
        }
        if (schoolBId) {
            await db.run("DELETE FROM grading_systems WHERE school_id = ?", [schoolBId]);
            await db.run("DELETE FROM settings WHERE school_id = ?", [schoolBId]);
            await db.run("DELETE FROM schools WHERE id = ?", [schoolBId]);
        }
        if (schoolUnconfId) {
            await db.run("DELETE FROM schools WHERE id = ?", [schoolUnconfId]);
        }
    }
}

runPhase3Tests().catch(err => {
    console.error('Fatal Phase 3 Test Error:', err);
    process.exit(1);
});
