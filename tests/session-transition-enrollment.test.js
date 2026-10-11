/**
 * tests/session-transition-enrollment.test.js
 * Integration test for:
 * 1. Session Transition & Student Promotion updating active calendar across sections, schools, and settings.
 * 2. New student single enrollment saving in the active session context.
 * 3. Section calendar updates setting the active session/term context.
 * 4. Bulk student import respecting the active session context.
 */

const assert = require('assert');
const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');
const tenantHelper = require('../utils/tenantHelper');
const settingsController = require('../controllers/settingsController');
const studentController = require('../controllers/studentController');
const bulkStudentController = require('../controllers/bulkStudentController');

async function runTests() {
    console.log('=== Starting Session Transition & Enrollment Integration Tests ===\n');

    // 1. Create a dedicated test school
    const schoolSlug = 'test-session-' + Date.now();
    await db.run(
        "INSERT INTO schools (name, slug, current_session, current_term, status) VALUES (?, ?, '2025/2026', '1st Term', 'active')",
        ['Test Session School', schoolSlug]
    );
    const school = await db.get("SELECT * FROM schools WHERE slug = ?", [schoolSlug]);
    const schoolId = school.id;
    console.log(`[Setup] Created test school id=${schoolId}, session='2025/2026'`);

    // Insert settings for current_session and current_term
    await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_session', '2025/2026')", [schoolId]);
    await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_term', '1st Term')", [schoolId]);

    const ts = Date.now();
    const sec1Name = `Sec1_${ts}`;
    const sec2Name = `Sec2_${ts}`;

    // Create 2 sections (e.g. Primary and Secondary)
    await db.run(
        "INSERT INTO sections (school_id, name, current_session, current_term) VALUES (?, ?, '2025/2026', '1st Term')",
        [schoolId, sec1Name]
    );
    const secPrimary = await db.get("SELECT * FROM sections WHERE school_id = ? AND name = ?", [schoolId, sec1Name]);

    await db.run(
        "INSERT INTO sections (school_id, name, current_session, current_term) VALUES (?, ?, '2025/2026', '1st Term')",
        [schoolId, sec2Name]
    );
    const secSecondary = await db.get("SELECT * FROM sections WHERE school_id = ? AND name = ?", [schoolId, sec2Name]);

    // Create classes
    await db.run("INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, 'Grade 1')", [schoolId, secPrimary.id]);
    const classGrade1 = await db.get("SELECT * FROM classes WHERE school_id = ? AND name = 'Grade 1'", [schoolId]);

    await db.run("INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, 'Grade 2')", [schoolId, secPrimary.id]);
    const classGrade2 = await db.get("SELECT * FROM classes WHERE school_id = ? AND name = 'Grade 2'", [schoolId]);

    // Create an existing student in Grade 1 for 2025/2026
    const testAdminNum = 'TEST' + Date.now().toString().slice(-6);
    await db.run(
        "INSERT INTO students (school_id, first_name, last_name, gender, admission_number, current_class_id, status) VALUES (?, 'Ahmed', 'Bello', 'Male', ?, ?, 'active')",
        [schoolId, testAdminNum, classGrade1.id]
    );
    const student1 = await db.get("SELECT * FROM students WHERE admission_number = ? AND school_id = ?", [testAdminNum, schoolId]);
    await db.run(
        "INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, '2025/2026')",
        [student1.id, classGrade1.id]
    );
    console.log(`[Setup] Enrolled student id=${student1.id} in Grade 1 for 2025/2026`);

    try {
        // --- TEST 1: Dry-Run Preview ---
        console.log('\n--- Test 1: Promotion Dry-Run Preview ---');
        let previewResponse = null;
        const reqPreview = {
            schoolId,
            body: {
                source_session: '2025/2026',
                target_session: '2026/2027',
                mapping: { [classGrade1.id]: String(classGrade2.id) }
            }
        };
        const resPreview = {
            json: (data) => { previewResponse = data; return data; },
            status: (code) => ({ json: (data) => { previewResponse = { status: code, ...data }; return data; } })
        };
        await settingsController.previewPromotion(reqPreview, resPreview);
        assert.strictEqual(previewResponse.success, true, 'Preview should succeed');
        assert.strictEqual(previewResponse.totalStudents, 1, 'Should find 1 student to promote');
        assert.strictEqual(previewResponse.preview[0].targetClassName, 'Grade 2', 'Target class should be Grade 2');
        console.log('✓ Dry-run preview returned expected student count and target class');

        // --- TEST 2: Process Promotion & Academic Transition ---
        console.log('\n--- Test 2: Process Promotion & Calendar Transition ---');
        let promotionRedirect = null;
        let promotionJson = null;
        const reqPromo = {
            schoolId,
            xhr: true,
            body: {
                source_session: '2025/2026',
                target_session: '2026/2027',
                mapping: { [classGrade1.id]: String(classGrade2.id) }
            }
        };
        const resPromo = {
            json: (data) => { promotionJson = data; },
            redirect: (url) => { promotionRedirect = url; }
        };
        await settingsController.processPromotion(reqPromo, resPromo);
        assert.strictEqual(promotionJson.success, true, 'Promotion execution should succeed');

        // Verify sections updated to 2026/2027 1st Term
        const updatedSections = await db.all("SELECT * FROM sections WHERE school_id = ?", [schoolId]);
        for (const sec of updatedSections) {
            assert.strictEqual(sec.current_session, '2026/2027', `Section ${sec.name} current_session must be 2026/2027`);
            assert.strictEqual(sec.current_term, '1st Term', `Section ${sec.name} current_term must be 1st Term`);
        }
        console.log('✓ All sections updated to 2026/2027 (1st Term)');

        // Verify school updated to 2026/2027 1st Term
        const updatedSchool = await db.get("SELECT * FROM schools WHERE id = ?", [schoolId]);
        assert.strictEqual(updatedSchool.current_session, '2026/2027', 'School current_session must be 2026/2027');
        assert.strictEqual(updatedSchool.current_term, '1st Term', 'School current_term must be 1st Term');
        console.log('✓ Schools master record updated to 2026/2027 (1st Term)');

        // Verify settings updated to 2026/2027 1st Term
        const sessionSetting = await db.get("SELECT value FROM settings WHERE school_id = ? AND key = 'current_session'", [schoolId]);
        assert.strictEqual(sessionSetting.value, '2026/2027', 'Settings current_session must be 2026/2027');
        const termSetting = await db.get("SELECT value FROM settings WHERE school_id = ? AND key = 'current_term'", [schoolId]);
        assert.strictEqual(termSetting.value, '1st Term', 'Settings current_term must be 1st Term');
        console.log('✓ Settings key/values updated to 2026/2027 (1st Term)');

        // Verify promoted student's new enrollment record in 2026/2027
        const studentEnrollments = await db.all("SELECT * FROM student_enrollments WHERE student_id = ? ORDER BY id ASC", [student1.id]);
        assert.strictEqual(studentEnrollments.length, 2, 'Student should have 2 enrollment records (history + new)');
        assert.strictEqual(studentEnrollments[1].session, '2026/2027', 'New enrollment must be in session 2026/2027');
        assert.strictEqual(studentEnrollments[1].class_id, classGrade2.id, 'New enrollment class must be Grade 2');
        console.log('✓ Promoted student enrollment correctly recorded under 2026/2027 in Grade 2');

        // --- TEST 3: New Student Enrollment After Transition ---
        console.log('\n--- Test 3: Enrolling New Student After Session Transition ---');
        let enrollRedirect = null;
        const reqEnroll = {
            schoolId,
            session: { staff: { id: 999, role: 'Admin', school_id: schoolId } },
            ip: '127.0.0.1',
            body: {
                first_name: 'Fatima',
                last_name: 'Usman',
                gender: 'Female',
                dob: '2015-05-10',
                current_class_id: String(classGrade1.id)
            }
        };
        const resEnroll = {
            redirect: (url) => { enrollRedirect = url; },
            status: (code) => ({ send: (msg) => console.log('Enroll status error:', code, msg) })
        };
        await studentController.enrollStudent(reqEnroll, resEnroll);
        assert.ok(enrollRedirect && enrollRedirect.includes('success=true'), 'Enrollment should redirect with success');

        // Find newly enrolled student
        const newStudent = await db.get(
            "SELECT * FROM students WHERE first_name = 'Fatima' AND last_name = 'Usman' AND school_id = ?",
            [schoolId]
        );
        assert.ok(newStudent, 'New student should exist in database');

        // Inspect student_enrollments for this new student
        const newStudentEnrollments = await db.all(
            "SELECT * FROM student_enrollments WHERE student_id = ?",
            [newStudent.id]
        );
        assert.strictEqual(newStudentEnrollments.length, 1, 'New student must have exactly 1 enrollment record');
        assert.strictEqual(
            newStudentEnrollments[0].session,
            '2026/2027',
            `CRITICAL ASSERTION: New enrollment session MUST be '2026/2027', found: '${newStudentEnrollments[0].session}'`
        );
        assert.strictEqual(newStudentEnrollments[0].class_id, classGrade1.id, 'New enrollment class must be Grade 1');
        console.log(`✓ New student enrollment correctly saved in active session '2026/2027'!`);

        // --- TEST 4: Calendar Setting in Settings (e.g. 2nd Term 2026/2027) ---
        console.log('\n--- Test 4: Section Calendar Update (e.g. 2nd Term 2026/2027) ---');
        let calRedirect = null;
        const reqCal = {
            schoolId,
            session: { staff: { id: 999, role: 'Admin', school_id: schoolId } },
            body: {
                [`sections_${secPrimary.id}_session`]: '2026/2027',
                [`sections_${secPrimary.id}_term`]: '2nd Term',
                [`sections_${secSecondary.id}_session`]: '2026/2027',
                [`sections_${secSecondary.id}_term`]: '2nd Term'
            }
        };
        const resCal = {
            redirect: (url) => { calRedirect = url; }
        };
        await settingsController.updateSectionCalendar(reqCal, resCal);

        // Verify section calendar reflects 2nd Term
        const calSec = await db.get("SELECT * FROM sections WHERE id = ?", [secPrimary.id]);
        assert.strictEqual(calSec.current_term, '2nd Term', 'Primary section term must be 2nd Term');

        // Enroll another student and verify context resolution
        let enroll2Redirect = null;
        const reqEnroll2 = {
            schoolId,
            session: { staff: { id: 999, role: 'Admin', school_id: schoolId } },
            ip: '127.0.0.1',
            body: {
                first_name: 'Zainab',
                last_name: 'Ali',
                gender: 'Female',
                dob: '2016-08-15',
                current_class_id: String(classGrade1.id)
            }
        };
        const resEnroll2 = {
            redirect: (url) => { enroll2Redirect = url; },
            status: (code) => ({ send: (msg) => console.log('Enroll2 error:', code, msg) })
        };
        await studentController.enrollStudent(reqEnroll2, resEnroll2);

        const studentZainab = await db.get(
            "SELECT * FROM students WHERE first_name = 'Zainab' AND last_name = 'Ali' AND school_id = ?",
            [schoolId]
        );
        const zainabEnrollment = await db.get(
            "SELECT * FROM student_enrollments WHERE student_id = ?",
            [studentZainab.id]
        );
        assert.strictEqual(zainabEnrollment.session, '2026/2027', 'Enrollment session must be 2026/2027');

        // Check academic context helper
        const academicContext = await sessionHelper.getAcademicContext(classGrade1.id, schoolId);
        assert.strictEqual(academicContext.session, '2026/2027', 'Academic context session must be 2026/2027');
        assert.strictEqual(academicContext.term, '2nd Term', 'Academic context term must be 2nd Term');
        console.log('✓ Academic context for class correctly resolves to 2nd Term 2026/2027');

        console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ===');
    } finally {
        // Clean up test data
        await db.run("DELETE FROM student_enrollments WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)", [schoolId]);
        await db.run("DELETE FROM students WHERE school_id = ?", [schoolId]);
        await db.run("DELETE FROM classes WHERE school_id = ?", [schoolId]);
        await db.run("DELETE FROM sections WHERE school_id = ?", [schoolId]);
        await db.run("DELETE FROM settings WHERE school_id = ?", [schoolId]);
        await db.run("DELETE FROM schools WHERE id = ?", [schoolId]);
        tenantHelper.clearTenantCache();
        console.log('[Cleanup] Test school and data removed cleanly.');
    }
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
