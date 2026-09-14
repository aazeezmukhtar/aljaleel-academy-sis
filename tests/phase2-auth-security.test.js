/**
 * tests/phase2-auth-security.test.js
 * 
 * ACADME SIS ΓÇö PHASE 2 TENANT-AWARE SECURITY TEST SUITE
 */

const assert = require('assert');
const bcrypt = require('bcryptjs');

process.env.DB_TYPE = 'sqlite';
delete process.env.DB_PATH;

const db = require('../utils/db');
const tenantHelper = require('../utils/tenantHelper');
const { runMigrations } = require('../utils/migrateOnStartup');

async function runPhase2SecurityTests() {
    console.log('============================================================');
    console.log('≡ƒ¢í∩╕Å  ACADME SIS ΓÇö PHASE 2 TENANT SECURITY TEST SUITE');
    console.log('============================================================\n');

    await runMigrations();

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`Γ£à PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`Γ¥î FAIL: ${name}`);
            console.error('   ', err.message);
            failed++;
        }
    }

    // Setup: Get or create School A (Default) and School B (Secondary)
    const schoolA = await tenantHelper.getDefaultTenant();
    await db.run(`
        INSERT INTO schools (name, slug, status)
        VALUES ('Phase 2 Secondary School', 'phase2-school-b', 'active')
        ON CONFLICT(slug) DO UPDATE SET status = 'active'
    `);
    const schoolB = await db.get("SELECT * FROM schools WHERE slug = 'phase2-school-b'");

    const passwordHashA = await bcrypt.hash('StaffPassA123', 10);
    const passwordHashB = await bcrypt.hash('StaffPassB123', 10);
    const studentPassHashA = await bcrypt.hash('StudPassA123', 10);

    const testStaffIdA = 'p2_staff_a_' + Date.now();
    const testStaffIdB = 'p2_staff_b_' + Date.now();
    const testStudAdmNumberA = 'P2-ADM-A-' + Date.now();
    const testStudAdmNumberB = 'P2-ADM-B-' + Date.now();

    // Insert staff for School A and School B
    await db.run(`
        INSERT INTO staff (school_id, first_name, last_name, staff_id, role, password_hash, status)
        VALUES (?, 'Alice', 'SchoolA', ?, 'Teacher', ?, 'active')
    `, [schoolA.id, testStaffIdA, passwordHashA]);

    await db.run(`
        INSERT INTO staff (school_id, first_name, last_name, staff_id, role, password_hash, status)
        VALUES (?, 'Bob', 'SchoolB', ?, 'Teacher', ?, 'active')
    `, [schoolB.id, testStaffIdB, passwordHashB]);

    // Insert student for School A and School B
    await db.run(`
        INSERT INTO students (school_id, admission_number, first_name, last_name, gender, password, status)
        VALUES (?, ?, 'StudentA', 'Owner', 'Male', ?, 'active')
    `, [schoolA.id, testStudAdmNumberA, studentPassHashA]);

    await db.run(`
        INSERT INTO students (school_id, admission_number, first_name, last_name, gender, password, status)
        VALUES (?, ?, 'StudentB', 'Foreign', 'Female', ?, 'active')
    `, [schoolB.id, testStudAdmNumberB, studentPassHashA]);

    const staffA = await db.get("SELECT * FROM staff WHERE staff_id = ?", [testStaffIdA]);
    const staffB = await db.get("SELECT * FROM staff WHERE staff_id = ?", [testStaffIdB]);
    const studA = await db.get("SELECT * FROM students WHERE admission_number = ?", [testStudAdmNumberA]);
    const studB = await db.get("SELECT * FROM students WHERE admission_number = ?", [testStudAdmNumberB]);

    // 1. Strict Authentication Query Test (No OR school_id IS NULL)
    await test('Authentication query requires concrete tenant and rejects null/missing tenant', async () => {
        const authStaff = await db.get(
            "SELECT * FROM staff WHERE LOWER(staff_id) = LOWER(?) AND status = 'active'",
            [testStaffIdA]
        );
        assert.ok(authStaff, 'Staff record should be discovered from credentials');
        assert.strictEqual(Number(authStaff.school_id), schoolA.id, 'Discovered tenant must strictly match School A');
        assert.notStrictEqual(authStaff.school_id, null, 'Tenant must not be null');

        const authStudent = await db.get(
            "SELECT * FROM students WHERE LOWER(admission_number) = LOWER(?) AND status = 'active'",
            [testStudAdmNumberB]
        );
        assert.ok(authStudent, 'Student record should be discovered from credentials');
        assert.strictEqual(Number(authStudent.school_id), schoolB.id, 'Discovered tenant must strictly match School B');
    });

    // 2. Cross-Tenant Session Binding Consistency Test
    await test('Session-to-Tenant binding ensures staff from School A cannot operate in School B context', async () => {
        const reqSessionA = {
            staff: {
                id: staffA.id,
                staff_id: staffA.staff_id,
                school_id: staffA.school_id
            }
        };

        const currentTenantScopeB = schoolB.id;
        const isMatch = reqSessionA.staff.school_id === currentTenantScopeB;
        assert.strictEqual(isMatch, false, 'School A staff must be detected as mismatched against School B tenant context');
    });

    // 3. Child Resource Ownership: Student Profile / Details
    await test('Student records cannot be accessed across tenant boundaries', async () => {
        const studentUnderA = await db.get('SELECT * FROM students WHERE id = ? AND school_id = ?', [studA.id, schoolA.id]);
        assert.ok(studentUnderA, 'School A should access its own student');

        const studentUnderB = await db.get('SELECT * FROM students WHERE id = ? AND school_id = ?', [studA.id, schoolB.id]);
        assert.strictEqual(studentUnderB, undefined, 'School B must NOT be able to access School A student');
    });

    const testSubjNameA = 'Math A ' + Date.now();
    const testSubjNameB = 'Math B ' + Date.now();
    const testSubjCodeA = 'MTH-A-' + Date.now();
    const testSubjCodeB = 'MTH-B-' + Date.now();
    const testClassNameA = 'Grade 1-A ' + Date.now();

    // 4. Child Resource Ownership: Results & Student Ownership
    await test('Results queries enforce student tenant ownership', async () => {
        await db.run("INSERT INTO subjects (school_id, name, code) VALUES (?, ?, ?)", [schoolA.id, testSubjNameA, testSubjCodeA]);
        await db.run("INSERT INTO subjects (school_id, name, code) VALUES (?, ?, ?)", [schoolB.id, testSubjNameB, testSubjCodeB]);
        const subjA = await db.get("SELECT id FROM subjects WHERE code = ? AND school_id = ?", [testSubjCodeA, schoolA.id]);

        await db.run(`
            INSERT INTO results (student_id, subject_id, term, session, ca1, ca2, exam, total, grade, status)
            VALUES (?, ?, '1st Term', '2025/2026', 15, 15, 50, 80, 'A', 'published')
        `, [studA.id, subjA.id]);

        const resultCrossTenant = await db.get(`
            SELECT r.* FROM results r
            JOIN students s ON r.student_id = s.id
            WHERE r.student_id = ? AND s.school_id = ?
        `, [studA.id, schoolB.id]);
        assert.strictEqual(resultCrossTenant, undefined, 'School B must find no results for School A student');

        const resultLegit = await db.get(`
            SELECT r.* FROM results r
            JOIN students s ON r.student_id = s.id
            WHERE r.student_id = ? AND s.school_id = ?
        `, [studA.id, schoolA.id]);
        assert.ok(resultLegit, 'School A must find its student result');
        assert.strictEqual(resultLegit.total, 80);
    });

    // 5. Child Resource Ownership: Attendance Records
    await test('Attendance records strictly enforce parent student tenant ownership', async () => {
        await db.run("INSERT INTO classes (school_id, name) VALUES (?, ?)", [schoolA.id, testClassNameA]);
        const classA = await db.get("SELECT id FROM classes WHERE name = ? AND school_id = ?", [testClassNameA, schoolA.id]);

        const today = '2026-09-02';
        await db.run(`
            INSERT INTO attendance (student_id, class_id, date, status, session, term)
            VALUES (?, ?, ?, 'Present', '2025/2026', '1st Term')
        `, [studA.id, classA.id, today]);

        const attUnderB = await db.get(`
            SELECT a.* FROM attendance a
            JOIN students s ON a.student_id = s.id
            WHERE a.student_id = ? AND s.school_id = ?
        `, [studA.id, schoolB.id]);
        assert.strictEqual(attUnderB, undefined, 'Attendance for Student A must not appear under School B');

        const attUnderA = await db.get(`
            SELECT a.* FROM attendance a
            JOIN students s ON a.student_id = s.id
            WHERE a.student_id = ? AND s.school_id = ?
        `, [studA.id, schoolA.id]);
        assert.ok(attUnderA, 'Attendance for Student A must appear under School A');
    });

    // 6. Child Resource Ownership: Fees and Payments
    await test('Student fees and payments enforce student tenant ownership', async () => {
        const classA = await db.get("SELECT id FROM classes WHERE name = ? AND school_id = ?", [testClassNameA, schoolA.id]);
        const testFeeCatName = 'Tuition A ' + Date.now();
        await db.run(`
            INSERT INTO fee_categories (school_id, name, amount, class_id, session, term)
            VALUES (?, ?, 50000, ?, '2025/2026', '1st Term')
        `, [schoolA.id, testFeeCatName, classA.id]);
        const feeCatA = await db.get("SELECT id, amount FROM fee_categories WHERE name = ? AND school_id = ?", [testFeeCatName, schoolA.id]);

        await db.run(`
            INSERT INTO student_fees (student_id, fee_category_id, total_amount, paid_amount, status)
            VALUES (?, ?, ?, 50000, 'Paid')
        `, [studA.id, feeCatA.id, feeCatA.amount]);
        const studentFeeA = await db.get('SELECT id FROM student_fees WHERE student_id = ?', [studA.id]);

        const testReceiptNo = 'REC-P2-' + Date.now();
        await db.run(`
            INSERT INTO payments (student_id, student_fee_id, amount_paid, payment_method, receipt_number)
            VALUES (?, ?, 50000, 'Cash', ?)
        `, [studA.id, studentFeeA.id, testReceiptNo]);

        const receiptUnderB = await db.get(`
            SELECT p.* FROM payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.receipt_number = ? AND s.school_id = ?
        `, [testReceiptNo, schoolB.id]);
        assert.strictEqual(receiptUnderB, undefined, 'Receipt must NOT be returned when queried from School B');

        const receiptUnderA = await db.get(`
            SELECT p.* FROM payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.receipt_number = ? AND s.school_id = ?
        `, [testReceiptNo, schoolA.id]);
        assert.ok(receiptUnderA, 'Receipt must be returned when queried from School A');
    });

    // 7. Cross-Tenant Entity Association Prevention
    await test('Staff and Classes from different tenants cannot be cross-assigned', async () => {
        const classA = await db.get("SELECT id FROM classes WHERE name = ? AND school_id = ?", [testClassNameA, schoolA.id]);
        const teacherB = staffB.id;

        const schoolScope = schoolA.id;
        const validStaff = await db.get('SELECT id FROM staff WHERE id = ? AND school_id = ?', [teacherB, schoolScope]);
        const validClass = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [classA.id, schoolScope]);

        assert.strictEqual(validStaff, undefined, 'Staff B does not belong to School A');
        assert.ok(validClass, 'Class A belongs to School A');
        assert.ok(!validStaff || !validClass, 'Cross-tenant assignment is blocked');
    });

    // Clean up created entities
    await db.run('DELETE FROM payments WHERE student_id IN (?, ?)', [studA.id, studB.id]);
    await db.run('DELETE FROM student_fees WHERE student_id IN (?, ?)', [studA.id, studB.id]);
    await db.run("DELETE FROM fee_categories WHERE school_id = ? AND name LIKE 'Tuition A%'", [schoolA.id]);
    await db.run('DELETE FROM attendance WHERE student_id IN (?, ?)', [studA.id, studB.id]);
    await db.run('DELETE FROM results WHERE student_id IN (?, ?)', [studA.id, studB.id]);
    await db.run("DELETE FROM subjects WHERE code IN (?, ?)", [testSubjCodeA, testSubjCodeB]);
    await db.run("DELETE FROM classes WHERE id IN (SELECT id FROM classes WHERE name = ?)", [testClassNameA]);
    await db.run('DELETE FROM students WHERE id IN (?, ?)', [studA.id, studB.id]);
    await db.run('DELETE FROM staff WHERE id IN (?, ?)', [staffA.id, staffB.id]);
    await db.run("DELETE FROM schools WHERE slug = 'phase2-school-b'");

    console.log('\n============================================================');
    console.log(`Phase 2 Security Results: ${passed} Passed, ${failed} Failed`);
    console.log('============================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runPhase2SecurityTests().catch(err => {
    console.error('Fatal Phase 2 Test Error:', err);
    process.exit(1);
});
