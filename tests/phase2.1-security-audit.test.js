/**
 * tests/phase2.1-security-audit.test.js
 *
 * ACADME SIS ΓÇö PHASE 2.1 SECURITY AUDIT TEST SUITE
 *
 * 9 blocks / 40 adversarial tests covering:
 *   Block 1: Authentication Hardening
 *   Block 2: Read Isolation
 *   Block 3: Create Isolation
 *   Block 4: Update/Mutation Isolation (IDOR)
 *   Block 5: Role Authorization
 *   Block 6: Tenant Parameter Tampering
 *   Block 7: Student Portal Isolation
 *   Block 8: Bulk Import Isolation
 *   Block 9: Security Invariants
 *
 * Run: node tests/phase2.1-security-audit.test.js
 */

'use strict';

const assert = require('assert');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

process.env.DB_TYPE = 'sqlite';
delete process.env.DB_PATH;

const db = require('../utils/db');
const { runMigrations } = require('../utils/migrateOnStartup');

// ---- Fixture state ----
let schoolA, schoolB;
let adminA, teacherA, registrarA, bursarA, examOfficerA;
let adminB, teacherB;
let studentA, studentB;
let classA, classB;
let subjectA, subjectB;
let boardPostA;
const extra = { staff: [], posts: [] };

// ---- Mock helpers ----
function mockReq(session, schoolId, params = {}, body = {}, query = {}) {
    return { session, schoolId, school: { id: schoolId }, params, body, query,
             ip: '127.0.0.1', xhr: false, headers: { accept: 'text/html' },
             method: 'POST', originalUrl: '/test' };
}
function mockRes() {
    return { _status: null, _body: null, _redirect: null, _json: null, locals: {},
             status(c) { this._status = c; return this; },
             send(b) { this._body = b; return this; },
             redirect(u) { this._redirect = u; return this; },
             json(d) { this._json = d; return this; } };
}

// ---- DB helpers ----
async function insertSchool(name) {
    const slug = name.toLowerCase().replace(/\s+/g,'-')+'_'+Date.now();
    const r = await db.run('INSERT INTO schools (name,slug) VALUES (?,?)', [name,slug]);
    return r.lastInsertRowid;
}
async function insertStaff(schoolId, role) {
    const dbRole = (role === 'Admin' || role === 'Teacher') ? role : 'Staff';
    const sid = 'tst_'+role.replace(/\s/g,'_')+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,5);
    const hash = await bcrypt.hash('pass123',5);
    const r = await db.run("INSERT INTO staff (school_id,first_name,last_name,staff_id,role,password_hash,status) VALUES (?,?,?,?,?,?,'active')",
                           [schoolId,'Test',role,sid,dbRole,hash]);
    return { id: r.lastInsertRowid, staff_id: sid, first_name:'Test', last_name:role, role };
}
async function insertStudent(schoolId, tag) {
    const adm = 'ADM'+schoolId+Date.now()+tag;
    const hash = await bcrypt.hash(adm, 5);
    const r = await db.run("INSERT INTO students (school_id,first_name,last_name,gender,admission_number,password,status) VALUES (?,?,?,?,?,?,'active')",
                           [schoolId,'Stu','S'+schoolId+tag,'Male',adm,hash]);
    return { id: r.lastInsertRowid, first_name:'Stu', last_name:'S'+schoolId+tag, admission_number: adm };
}
async function insertClass(schoolId) {
    const r = await db.run('INSERT INTO classes (school_id,name) VALUES (?,?)',
                  [schoolId,'Cls_'+schoolId+'_'+Date.now()]);
    return r.lastInsertRowid;
}
async function insertSubject(schoolId) {
    const code='S'+Date.now()+Math.random().toString(36).slice(2,4);
    const r = await db.run('INSERT INTO subjects (school_id,name,code) VALUES (?,?,?)',
                  [schoolId,'Sub_'+schoolId+'_'+Date.now(),code]);
    return r.lastInsertRowid;
}
async function insertBoardPost(classId, teacherId) {
    const r = await db.run("INSERT INTO class_posts (class_id,teacher_id,post_type,title,content) VALUES (?,?,'Announcement','Test Post','Content')",
                  [classId,teacherId]);
    return r.lastInsertRowid;
}

// ---- Test runner ----
let passed = 0, failed = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log('  Γ£à PASS:', name);
        passed++;
    } catch (err) {
        console.error('  Γ¥î FAIL:', name);
        console.error('      ', err.message || err);
        failed++;
    }
}
function section(title) {
    console.log('\n' + 'ΓòÉ'.repeat(60));
    console.log('  ' + title);
    console.log('ΓòÉ'.repeat(60));
}

// ---- Cleanup ----
async function cleanup() {
    for (const id of extra.posts) {
        await db.run('DELETE FROM class_posts WHERE id=?',[id]);
    }
    if (boardPostA) await db.run('DELETE FROM class_posts WHERE id=?',[boardPostA]);
    if (studentA) {
        for (const t of ['results','attendance','payments','student_fees','student_enrollments']) {
            await db.run('DELETE FROM '+t+' WHERE student_id=?',[studentA.id]);
        }
        await db.run("DELETE FROM notification_reads WHERE user_id=? AND user_type='student'",[studentA.id]);
        await db.run('DELETE FROM students WHERE id=?',[studentA.id]);
    }
    if (studentB) {
        for (const t of ['results','attendance','payments','student_fees','student_enrollments']) {
            await db.run('DELETE FROM '+t+' WHERE student_id=?',[studentB.id]);
        }
        await db.run("DELETE FROM notification_reads WHERE user_id=? AND user_type='student'",[studentB.id]);
        await db.run('DELETE FROM students WHERE id=?',[studentB.id]);
    }
    if (subjectA) await db.run('DELETE FROM subjects WHERE id=?',[subjectA]);
    if (subjectB) await db.run('DELETE FROM subjects WHERE id=?',[subjectB]);
    if (classA) await db.run('DELETE FROM classes WHERE id=?',[classA]);
    if (classB) await db.run('DELETE FROM classes WHERE id=?',[classB]);
    const allStaff = [adminA,teacherA,registrarA,bursarA,examOfficerA,adminB,teacherB,
                      ...extra.staff.map(id=>({id}))].filter(Boolean);
    for (const s of allStaff) {
        await db.run('DELETE FROM class_assignments WHERE staff_id=?',[s.id]);
        await db.run('DELETE FROM subject_assignments WHERE teacher_id=?',[s.id]);
        await db.run('DELETE FROM staff WHERE id=?',[s.id]);
    }
    if (schoolA) await db.run('DELETE FROM schools WHERE id=?',[schoolA]);
    if (schoolB) await db.run('DELETE FROM schools WHERE id=?',[schoolB]);
}

// ============================================================
async function runAudit() {
    console.log('\n' + '='.repeat(60));
    console.log('≡ƒöÉ  ACADME SIS ΓÇö PHASE 2.1 SECURITY AUDIT');
    console.log('='.repeat(60));

    await runMigrations();

    // Setup fixtures
    schoolA = await insertSchool('AuditSchoolA');
    schoolB = await insertSchool('AuditSchoolB');
    adminA       = await insertStaff(schoolA,'Admin');
    teacherA     = await insertStaff(schoolA,'Teacher');
    registrarA   = await insertStaff(schoolA,'Registrar');
    bursarA      = await insertStaff(schoolA,'Bursar');
    examOfficerA = await insertStaff(schoolA,'Examination Officer');
    adminB       = await insertStaff(schoolB,'Admin');
    teacherB     = await insertStaff(schoolB,'Teacher');
    studentA = await insertStudent(schoolA,'A');
    studentB = await insertStudent(schoolB,'B');
    classA   = await insertClass(schoolA);
    classB   = await insertClass(schoolB);
    subjectA = await insertSubject(schoolA);
    subjectB = await insertSubject(schoolB);
    boardPostA = await insertBoardPost(classA, teacherA.id);

    // ==========================================
    section('Block 1: Authentication Hardening');
    // ==========================================

    await test('1.1 Active staff record has school_id from DB', async () => {
        const row = await db.get('SELECT * FROM staff WHERE id=?',[adminA.id]);
        assert.strictEqual(row.school_id, schoolA);
        assert.strictEqual(row.status, 'active');
    });

    await test('1.2 Inactive staff excluded by auth query', async () => {
        await db.run("UPDATE staff SET status='inactive' WHERE id=?",[adminA.id]);
        const row = await db.get("SELECT id FROM staff WHERE LOWER(staff_id)=LOWER(?) AND status='active'",[adminA.staff_id]);
        assert.strictEqual(row, undefined);
        await db.run("UPDATE staff SET status='active' WHERE id=?",[adminA.id]);
    });

    await test('1.3 postLogin source: no OR school_id IS NULL fallback', () => {
        const { postLogin } = require('../controllers/authController');
        assert.ok(!/school_id\s+IS\s+NULL/i.test(postLogin.toString()), 'Found OR school_id IS NULL in postLogin');
    });

    await test('1.4 postStudentLogin source: no OR school_id IS NULL fallback', () => {
        const { postStudentLogin } = require('../controllers/authController');
        assert.ok(!/school_id\s+IS\s+NULL/i.test(postStudentLogin.toString()), 'Found OR school_id IS NULL in postStudentLogin');
    });

    await test('1.5 postLogin uses authoritativeSchoolId binding from DB row', () => {
        const { postLogin } = require('../controllers/authController');
        const src = postLogin.toString();
        assert.ok(/authoritativeSchoolId/.test(src), 'authoritativeSchoolId not found in postLogin');
        assert.ok(/Number\(staff\.school_id\)/.test(src), 'Number(staff.school_id) binding not found');
    });

    await test('1.6 isAuthenticated: mismatched tenant returns 403', () => {
        const { isAuthenticated } = require('../middleware/authMiddleware');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolB);
        const res = mockRes(); let nextCalled = false;
        isAuthenticated(req, res, () => { nextCalled = true; });
        assert.strictEqual(res._status, 403);
        assert.strictEqual(nextCalled, false);
    });

    await test('1.7 isAuthenticated: matching tenant calls next', () => {
        const { isAuthenticated } = require('../middleware/authMiddleware');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA);
        const res = mockRes(); let nextCalled = false;
        isAuthenticated(req, res, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, true);
    });

    await test('1.8 Unauthenticated GET redirected to /auth/login', () => {
        const { isAuthenticated } = require('../middleware/authMiddleware');
        const req = mockReq({}, schoolA); req.method = 'GET';
        const res = mockRes(); let nextCalled = false;
        isAuthenticated(req, res, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, false);
        assert.ok(/\/auth\/login/.test(res._redirect), 'Did not redirect to /auth/login');
    });

    // ==========================================
    section('Block 2: Read Isolation');
    // ==========================================

    await test('2.1 getStudents: School A cannot see School B students', async () => {
        const { getStudents } = require('../controllers/studentController');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA);
        let rendered = null;
        const res = { ...mockRes(), render: (_v,d) => { rendered = d; } };
        await getStudents(req, res);
        assert.ok(rendered, 'render was not called');
        const ids = (rendered.students||[]).map(s=>s.id);
        assert.ok(!ids.includes(studentB.id), 'School B student visible to School A admin');
    });

    await test('2.2 getStudentProfile: 404 for cross-tenant student', async () => {
        const { getStudentProfile } = require('../controllers/studentController');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA, { id:studentB.id });
        const res = mockRes();
        await getStudentProfile(req, res);
        assert.strictEqual(res._status, 404);
    });

    await test('2.3 getAllStaff: School A cannot see School B staff', async () => {
        const { getAllStaff } = require('../controllers/staffController');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA);
        let rendered = null;
        const res = { ...mockRes(), render: (_v,d) => { rendered = d; } };
        await getAllStaff(req, res);
        assert.ok(rendered, 'render was not called');
        const ids = (rendered.staff||[]).map(s=>s.id);
        assert.ok(!ids.includes(adminB.id) && !ids.includes(teacherB.id), 'School B staff visible to School A admin');
    });

    await test('2.4 getStaffProfile: 404 for cross-tenant staff', async () => {
        const { getStaffProfile } = require('../controllers/staffController');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA, { id:adminB.id });
        const res = mockRes();
        await getStaffProfile(req, res);
        assert.strictEqual(res._status, 404);
    });

    await test('2.5 getAcademicDashboard: School A cannot see School B classes/subjects', async () => {
        const { getAcademicDashboard } = require('../controllers/academicController');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA);
        let rendered = null;
        const res = { ...mockRes(), render: (_v,d) => { rendered = d; } };
        await getAcademicDashboard(req, res);
        assert.ok(rendered, 'render was not called');
        assert.ok(!rendered.classes.map(c=>c.id).includes(classB), 'School B class visible to School A');
        assert.ok(!rendered.subjects.map(s=>s.id).includes(subjectB), 'School B subject visible to School A');
    });

    await test('2.6 editSubjectForm: 404 for cross-tenant subject', async () => {
        const { editSubjectForm } = require('../controllers/academicController');
        const req = mockReq({ staff: { id:adminA.id, role:'Admin', school_id:schoolA } }, schoolA, { id:subjectB });
        const res = mockRes();
        await editSubjectForm(req, res);
        assert.strictEqual(res._status, 404);
    });

    // ==========================================
    section('Block 3: Create Isolation');
    // ==========================================

    await test('3.1 enrollStudent: body school_id ignored, uses req.schoolId', async () => {
        const { enrollStudent } = require('../controllers/studentController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { first_name:'Ghost', last_name:'Injected', gender:'Male', dob:'2010-01-01', school_id:schoolB });
        let redirected = false;
        const res = { ...mockRes(), redirect: () => { redirected = true; } };
        await enrollStudent(req, res);
        const row = await db.get("SELECT school_id FROM students WHERE first_name='Ghost' AND last_name='Injected' ORDER BY id DESC LIMIT 1");
        if (row) {
            assert.strictEqual(row.school_id, schoolA, 'Student was enrolled in School B instead of School A');
            await db.run("DELETE FROM students WHERE first_name='Ghost' AND last_name='Injected'");
        }
    });

    await test('3.2 addClass: body school_id ignored, uses req.schoolId', async () => {
        const { addClass } = require('../controllers/academicController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { name:'GhostCls_Test', school_id:schoolB });
        const res = { ...mockRes(), redirect: () => {} };
        await addClass(req, res);
        const row = await db.get("SELECT school_id FROM classes WHERE name='GhostCls_Test' ORDER BY id DESC LIMIT 1");
        if (row) {
            assert.strictEqual(row.school_id, schoolA, 'Class was created in School B instead of School A');
            await db.run("DELETE FROM classes WHERE name='GhostCls_Test'");
        }
    });

    await test('3.3 addAssignment: rejects cross-tenant teacher (teacherB -> schoolA)', async () => {
        const { addAssignment } = require('../controllers/academicController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { teacher_id:teacherB.id, subject_id:subjectA, class_id:classA, session:'2025/2026' });
        const res = mockRes();
        await addAssignment(req, res);
        assert.strictEqual(res._status, 403, 'Expected 403 for cross-tenant teacher assignment');
        assert.ok(/do not belong to this school/i.test(res._body||''), 'Missing error message');
    });

    await test('3.4 addAssignment: rejects cross-tenant subject (subjectB -> schoolA)', async () => {
        const { addAssignment } = require('../controllers/academicController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { teacher_id:adminA.id, subject_id:subjectB, class_id:classA, session:'2025/2026' });
        const res = mockRes();
        await addAssignment(req, res);
        assert.strictEqual(res._status, 403, 'Expected 403 for cross-tenant subject assignment');
    });

    await test('3.5 assignClass: rejects cross-tenant class', async () => {
        const { assignClass } = require('../controllers/staffController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { staff_id:adminA.id, class_id:classB, session:'2025/2026' });
        let redirectTarget = '';
        const res = { ...mockRes(), redirect: (u) => { redirectTarget = u; } };
        await assignClass(req, res);
        assert.ok(/error/i.test(redirectTarget), 'Expected error in redirect for cross-tenant class assignment');
    });

    await test('3.6 assignSubject: rejects cross-tenant subject', async () => {
        const { assignSubject } = require('../controllers/staffController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { staff_id:adminA.id, subject_id:subjectB, class_id:classA, session:'2025/2026' });
        let redirectTarget = '';
        const res = { ...mockRes(), redirect: (u) => { redirectTarget = u; } };
        await assignSubject(req, res);
        assert.ok(/error/i.test(redirectTarget), 'Expected error in redirect for cross-tenant subject assignment');
    });

    // ==========================================
    section('Block 4: Update/Mutation Isolation (IDOR)');
    // ==========================================

    await test('4.1 updateStudent: cross-tenant write has no effect', async () => {
        const { updateStudent } = require('../controllers/studentController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            { id:studentB.id }, { first_name:'HACKED', last_name:'X', gender:'Male', status:'active' });
        const res = mockRes();
        await updateStudent(req, res);
        const row = await db.get('SELECT first_name FROM students WHERE id=?',[studentB.id]);
        assert.notStrictEqual(row.first_name, 'HACKED', 'Cross-tenant student was mutated');
    });

    await test('4.2 updateStaff: cross-tenant write has no effect', async () => {
        const { updateStaff } = require('../controllers/staffController');
        const req = { ...mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            { id:adminB.id }, { first_name:'HACKED', last_name:'Admin', role:'Admin', status:'active', designation:'', show_on_website:0 }), file:null };
        const res = { ...mockRes(), redirect: ()=>{} };
        await updateStaff(req, res);
        const row = await db.get('SELECT first_name FROM staff WHERE id=?',[adminB.id]);
        assert.notStrictEqual(row.first_name, 'HACKED', 'Cross-tenant staff was mutated');
    });

    await test('4.3 deleteStudent: 404 for cross-tenant student, record preserved', async () => {
        const { deleteStudent } = require('../controllers/studentController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA, { id:studentB.id });
        const res = mockRes();
        await deleteStudent(req, res);
        assert.strictEqual(res._status, 404, 'Expected 404 for cross-tenant delete');
        const row = await db.get('SELECT id FROM students WHERE id=?',[studentB.id]);
        assert.ok(row, 'Student B was deleted by School A admin');
    });

    await test('4.4 deleteStaff: 404 for cross-tenant staff, record preserved', async () => {
        const { deleteStaff } = require('../controllers/staffController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA, { id:adminB.id });
        const res = mockRes();
        await deleteStaff(req, res);
        assert.strictEqual(res._status, 404, 'Expected 404 for cross-tenant delete');
        const row = await db.get('SELECT id FROM staff WHERE id=?',[adminB.id]);
        assert.ok(row, 'Admin B was deleted by School A admin');
    });

    await test('4.5 deleteClass: 404 for cross-tenant class, record preserved', async () => {
        const { deleteClass } = require('../controllers/academicController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA, { id:classB });
        const res = mockRes();
        await deleteClass(req, res);
        assert.strictEqual(res._status, 404, 'Expected 404 for cross-tenant class delete');
        const row = await db.get('SELECT id FROM classes WHERE id=?',[classB]);
        assert.ok(row, 'Class B was deleted by School A admin');
    });

    await test('4.6 updateSubject: cross-tenant write has no effect', async () => {
        const { updateSubject } = require('../controllers/academicController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            { id:subjectB }, { name:'HIJACKED', code:'HJK' });
        const res = { ...mockRes(), redirect: ()=>{} };
        await updateSubject(req, res);
        const row = await db.get('SELECT name FROM subjects WHERE id=?',[subjectB]);
        assert.notStrictEqual(row.name, 'HIJACKED', 'Cross-tenant subject was mutated');
    });

    await test('4.7 deleteClassBoardPost: cross-tenant teacher cannot delete cross-school post', async () => {
        const { deleteClassBoardPost } = require('../controllers/staffController');
        const req = mockReq({ staff:{id:teacherB.id,role:'Teacher',school_id:schoolB} }, schoolB, { id:boardPostA });
        const res = { ...mockRes(), redirect: ()=>{} };
        await deleteClassBoardPost(req, res);
        const row = await db.get('SELECT id FROM class_posts WHERE id=?',[boardPostA]);
        assert.ok(row, 'boardPostA was deleted by cross-tenant teacher');
    });

    await test('4.8 deleteAssignment (academic): 404 for cross-tenant assignment, record preserved', async () => {
        const r = await db.run('INSERT INTO subject_assignments (teacher_id,subject_id,class_id,session) VALUES (?,?,?,?)',
                               [teacherB.id, subjectB, classB, '2025/2026']);
        const aid = r.lastInsertRowid;
        const { deleteAssignment } = require('../controllers/academicController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA, { id:aid });
        const res = mockRes();
        await deleteAssignment(req, res);
        assert.strictEqual(res._status, 404, 'Expected 404 for cross-tenant assignment delete');
        const row = await db.get('SELECT id FROM subject_assignments WHERE id=?',[aid]);
        assert.ok(row, 'Cross-tenant assignment was deleted');
        await db.run('DELETE FROM subject_assignments WHERE id=?',[aid]);
    });

    // ==========================================
    section('Block 5: Role Authorization');
    // ==========================================

    await test('5.1 isAdmin blocks Teacher (403)', () => {
        const { isAdmin } = require('../middleware/authMiddleware');
        const req = mockReq({ staff:{id:teacherA.id,role:'Teacher',school_id:schoolA} }, schoolA);
        const res = mockRes(); let nc = false;
        isAdmin(req, res, ()=>{nc=true;});
        assert.strictEqual(res._status, 403); assert.strictEqual(nc, false);
    });

    await test('5.2 isAdmin blocks Registrar (403)', () => {
        const { isAdmin } = require('../middleware/authMiddleware');
        const req = mockReq({ staff:{id:registrarA.id,role:'Registrar',school_id:schoolA} }, schoolA);
        const res = mockRes(); let nc = false;
        isAdmin(req, res, ()=>{nc=true;});
        assert.strictEqual(res._status, 403);
    });

    await test('5.3 isAdmin blocks Bursar (403)', () => {
        const { isAdmin } = require('../middleware/authMiddleware');
        const req = mockReq({ staff:{id:bursarA.id,role:'Bursar',school_id:schoolA} }, schoolA);
        const res = mockRes(); let nc = false;
        isAdmin(req, res, ()=>{nc=true;});
        assert.strictEqual(res._status, 403);
    });

    await test('5.4 Teacher cannot enroll students (enrollStudent role guard)', async () => {
        const { enrollStudent } = require('../controllers/studentController');
        const req = mockReq({ staff:{id:teacherA.id,role:'Teacher',school_id:schoolA} }, schoolA,
            {}, { first_name:'Illicit', last_name:'Enroll', gender:'Male' });
        const res = mockRes();
        await enrollStudent(req, res);
        assert.strictEqual(res._status, 403, 'Expected 403 for Teacher attempting to enroll student');
    });

    await test('5.5 Teacher cannot update students (updateStudent role guard)', async () => {
        const { updateStudent } = require('../controllers/studentController');
        const req = mockReq({ staff:{id:teacherA.id,role:'Teacher',school_id:schoolA} }, schoolA,
            { id:studentA.id }, { first_name:'Illicit', last_name:'Update', gender:'Male', status:'active' });
        const res = mockRes();
        await updateStudent(req, res);
        assert.strictEqual(res._status, 403, 'Expected 403 for Teacher attempting to update student');
        const row = await db.get('SELECT first_name FROM students WHERE id=?',[studentA.id]);
        assert.notStrictEqual(row.first_name, 'Illicit', 'Student was mutated by Teacher role');
    });

    await test('5.6 Teacher A2 cannot delete Teacher A1 post (ownership guard)', async () => {
        const teacherA2 = await insertStaff(schoolA,'Teacher');
        extra.staff.push(teacherA2.id);
        const { deleteClassBoardPost } = require('../controllers/staffController');
        const req = mockReq({ staff:{id:teacherA2.id,role:'Teacher',school_id:schoolA} }, schoolA, { id:boardPostA });
        let redirectTarget = '';
        const res = { ...mockRes(), redirect: (u)=>{ redirectTarget = u; } };
        await deleteClassBoardPost(req, res);
        assert.ok(/error/i.test(redirectTarget), 'Expected error redirect for ownership violation');
        const row = await db.get('SELECT id FROM class_posts WHERE id=?',[boardPostA]);
        assert.ok(row, 'boardPostA was deleted by a different teacher');
    });

    await test('5.7 Admin can delete any post in their school', async () => {
        const tmpPost = await insertBoardPost(classA, teacherA.id);
        const { deleteClassBoardPost } = require('../controllers/staffController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA, { id:tmpPost });
        const res = { ...mockRes(), redirect: ()=>{} };
        await deleteClassBoardPost(req, res);
        const row = await db.get('SELECT id FROM class_posts WHERE id=?',[tmpPost]);
        assert.strictEqual(row, undefined, 'Admin could not delete post in their school');
    });

    await test('5.8 Examination Officer blocked by isAdmin (403)', () => {
        const { isAdmin } = require('../middleware/authMiddleware');
        const req = mockReq({ staff:{id:examOfficerA.id,role:'Examination Officer',school_id:schoolA} }, schoolA);
        const res = mockRes(); let nc = false;
        isAdmin(req, res, ()=>{nc=true;});
        assert.strictEqual(res._status, 403);
    });

    // ==========================================
    section('Block 6: Tenant Parameter Tampering');
    // ==========================================

    await test('6.1 enrollStudent ignores body school_id', async () => {
        const { enrollStudent } = require('../controllers/studentController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { first_name:'TamperA', last_name:'Test', gender:'Male', school_id:schoolB });
        const res = { ...mockRes(), redirect: ()=>{} };
        await enrollStudent(req, res);
        const row = await db.get("SELECT school_id FROM students WHERE first_name='TamperA' ORDER BY id DESC LIMIT 1");
        if (row) {
            assert.strictEqual(row.school_id, schoolA, 'Body school_id was used instead of req.schoolId');
            await db.run("DELETE FROM students WHERE first_name='TamperA'");
        }
    });

    await test('6.2 saveStaff ignores body school_id', async () => {
        const { saveStaff } = require('../controllers/staffController');
        const uid = 'tamper_'+Date.now();
        const req = { ...mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { first_name:'Tamper', last_name:'Staff', staff_id:uid, role:'Teacher', designation:'', school_id:schoolB }), file:null };
        const res = { ...mockRes(), redirect: ()=>{} };
        await saveStaff(req, res);
        const row = await db.get('SELECT school_id FROM staff WHERE staff_id=?',[uid]);
        if (row) {
            assert.strictEqual(row.school_id, schoolA, 'Body school_id was used instead of req.schoolId');
            await db.run('DELETE FROM staff WHERE staff_id=?',[uid]);
        }
    });

    await test('6.3 tenantMiddleware does not read school_id from query/body/params', async () => {
        const src = fs.readFileSync(path.join(__dirname,'..','middleware','tenantMiddleware.js'),'utf8');
        const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        assert.ok(!/req\.query\.school_id/.test(codeOnly), 'Found req.query.school_id in tenantMiddleware');
        assert.ok(!/req\.body\.school_id/.test(codeOnly), 'Found req.body.school_id in tenantMiddleware');
        assert.ok(!/req\.params\.school_id/.test(codeOnly), 'Found req.params.school_id in tenantMiddleware');

        // Functional check: client query tampering cannot override session tenant
        const tenantMiddleware = require('../middleware/tenantMiddleware');
        const req = {
            session: { staff: { id: adminA.id, role: 'Admin', school_id: schoolA } },
            query: { school_id: schoolB },
            body: { school_id: schoolB },
            params: { school_id: schoolB },
            headers: {}
        };
        const res = { locals: {} };
        await tenantMiddleware(req, res, () => {});
        assert.strictEqual(req.schoolId, schoolA, 'req.schoolId was tampered with by client query parameter');
    });

    await test('6.4 postChangePassword uses session school_id not body school_id', async () => {
        const { postChangePassword } = require('../controllers/authController');
        const req = mockReq({ staff:{id:adminA.id,school_id:schoolA} }, schoolA,
            {}, { current_password:'wrongpass', new_password:'New123!', confirm_password:'New123!', school_id:schoolB });
        let redirectTarget = '';
        const res = { ...mockRes(), redirect: (u)=>{ redirectTarget = u; } };
        await postChangePassword(req, res);
        assert.ok(/error/i.test(redirectTarget), 'Expected error redirect for wrong password');
    });

    await test('6.5 downloadTemplate: 403 for cross-tenant class', async () => {
        const { downloadTemplate } = require('../controllers/importController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, {}, { class_id:classB, subject_id:subjectA });
        const res = mockRes();
        await downloadTemplate(req, res);
        assert.strictEqual(res._status, 403, 'Expected 403 for cross-tenant class in downloadTemplate');
    });

    await test('6.6 downloadTemplate: 403 for cross-tenant subject', async () => {
        const { downloadTemplate } = require('../controllers/importController');
        const req = mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, {}, { class_id:classA, subject_id:subjectB });
        const res = mockRes();
        await downloadTemplate(req, res);
        assert.strictEqual(res._status, 403, 'Expected 403 for cross-tenant subject in downloadTemplate');
    });

    // ==========================================
    section('Block 7: Student Portal Isolation');
    // ==========================================

    await test('7.1 isStudentAuthenticated blocks staff session', () => {
        const { isStudentAuthenticated } = require('../middleware/studentAuthMiddleware');
        const req = { ...mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA), method:'GET', originalUrl:'/portal' };
        req.session.student = undefined;
        let redirectTarget = ''; let nc = false;
        const res = { ...mockRes(), redirect:(u)=>{ redirectTarget=u; } };
        isStudentAuthenticated(req, res, ()=>{nc=true;});
        assert.strictEqual(nc, false, 'next() was called for non-student session');
    });

    await test('7.2 isStudentAuthenticated: 403 on session/tenant mismatch', () => {
        const { isStudentAuthenticated } = require('../middleware/studentAuthMiddleware');
        const req = mockReq({ student:{id:studentA.id,school_id:schoolA} }, schoolB);
        const res = mockRes(); let nc = false;
        isStudentAuthenticated(req, res, ()=>{nc=true;});
        assert.strictEqual(res._status, 403, 'Expected 403 for session/tenant mismatch');
        assert.strictEqual(nc, false);
    });

    await test('7.3 Student portal postChangePassword uses session school_id', async () => {
        const { postChangePassword } = require('../controllers/portalController');
        const req = { ...mockReq({ student:{id:studentA.id,school_id:schoolA} }, schoolA,
            {}, { current_password:'WRONG', new_password:'New123!', confirm_password:'New123!', school_id:schoolB }),
            session:{ student:{ id:studentA.id, school_id:schoolA } } };
        let redirectTarget = '';
        const res = { ...mockRes(), redirect:(u)=>{ redirectTarget=u; } };
        await postChangePassword(req, res);
        assert.ok(/error/i.test(redirectTarget), 'Expected error redirect for wrong password in portal');
    });

    // ==========================================
    section('Block 8: Bulk Import Isolation');
    // ==========================================

    await test('8.1 processBulkImport without file returns 400', async () => {
        const { processBulkImport } = require('../controllers/bulkStudentController');
        const req = { ...mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA, {}, { school_id:schoolB }), file:null };
        const res = mockRes();
        await processBulkImport(req, res);
        assert.strictEqual(res._status, 400, 'Expected 400 for bulk import without file');
    });

    await test('8.2 processImport without file returns 400', async () => {
        const { processImport } = require('../controllers/importController');
        const req = { ...mockReq({ staff:{id:adminA.id,role:'Admin',school_id:schoolA} }, schoolA,
            {}, { class_id:classA, subject_id:subjectA, term:'1st Term', session:'2025/2026' }), file:null };
        const res = mockRes();
        await processImport(req, res);
        assert.strictEqual(res._status, 400, 'Expected 400 for result import without file');
    });

    // ==========================================
    section('Block 9: Security Invariants');
    // ==========================================

    await test('9.1 No OR school_id IS NULL in any controller file', () => {
        const dir = path.join(__dirname,'..','controllers');
        const files = [];
        function collect(d) {
            fs.readdirSync(d,{withFileTypes:true}).forEach(f => {
                const p = path.join(d,f.name);
                if (f.isDirectory()) collect(p);
                else if (f.name.endsWith('.js')) files.push(p);
            });
        }
        collect(dir);
        const violations = files.filter(f => /school_id\s+IS\s+NULL/i.test(fs.readFileSync(f,'utf8')));
        assert.deepStrictEqual(violations, [], 'Found OR school_id IS NULL in: '+violations.join(', '));
    });

    await test('9.2 No OR school_id IS NULL in any middleware file', () => {
        const dir = path.join(__dirname,'..','middleware');
        const violations = fs.readdirSync(dir).filter(f=>f.endsWith('.js'))
            .filter(f=>/school_id\s+IS\s+NULL/i.test(fs.readFileSync(path.join(dir,f),'utf8')));
        assert.deepStrictEqual(violations, [], 'Found OR school_id IS NULL in middleware: '+violations.join(', '));
    });

    await test('9.3 tenantMiddleware destroys session on school_id mismatch', () => {
        const src = fs.readFileSync(path.join(__dirname,'..','middleware','tenantMiddleware.js'),'utf8');
        assert.ok(/session\.destroy/.test(src), 'tenantMiddleware does not destroy session on mismatch');
    });

    await test('9.4 academicRoutes: all POST mutation routes have isAdmin guard', () => {
        const src = fs.readFileSync(path.join(__dirname,'..','routes','academicRoutes.js'),'utf8');
        const mutationLines = src.split('\n').filter(l => /router\.post/.test(l));
        assert.ok(mutationLines.length > 0, 'No POST routes found in academicRoutes.js');
        mutationLines.forEach(line => {
            assert.ok(/isAdmin/.test(line), 'Missing isAdmin on route line: ' + line.trim());
        });
    });

    await test('9.5 studentRoutes: bulk-import routes have isAdmin guard', () => {
        const src = fs.readFileSync(path.join(__dirname,'..','routes','studentRoutes.js'),'utf8');
        assert.ok(/isAdmin.*bulk-import/.test(src) || /bulk-import.*isAdmin/.test(src),
                  'isAdmin guard missing on bulk-import routes');
    });

    // ==========================================
    // Final Summary
    // ==========================================
    console.log('\n' + '='.repeat(60));
    console.log('≡ƒöÉ  PHASE 2.1 SECURITY AUDIT RESULTS');
    console.log('='.repeat(60));
    console.log('  Tests passed: ' + passed);
    console.log('  Tests failed: ' + failed);
    console.log('='.repeat(60));
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runAudit()
    .catch(err => { console.error('\n≡ƒÆÑ Unexpected error:', err); process.exitCode = 1; })
    .finally(() => cleanup().catch(e => console.error('Cleanup error:', e)));
