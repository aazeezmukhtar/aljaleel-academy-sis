'use strict';
const assert = require('assert');
const path = require('path');

// Fail closed: this test must only use the disposable CI/test SQLite database.
if (process.env.NODE_ENV !== 'test') throw new Error('Refusing promotion test outside NODE_ENV=test.');
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = process.env.DB_PATH || '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;
if (path.basename(process.env.DB_PATH) !== '.test-database.sqlite') {
  throw new Error('Refusing promotion test: DB_PATH must be .test-database.sqlite.');
}

const db = require('../utils/db');
const controller = require('../controllers/settingsController');
const response = () => ({
  data: null, statusCode: 200,
  json(data) { this.data = data; return data; },
  status(code) { this.statusCode = code; return { json: data => { this.data = data; return data; } }; }
});

async function run() {
  const token = Date.now().toString();
  const slug = 'promotion-regression-' + token;
  let schoolId = null;
  let foreignSchoolId = null;
  try {
    await db.run("INSERT INTO schools (name, slug, current_session, current_term, status) VALUES (?, ?, '2025/2026', '2nd Term', 'active')", ['Promotion Test ' + token, slug]);
    schoolId = (await db.get('SELECT id FROM schools WHERE slug = ?', [slug])).id;
    await db.run("INSERT INTO schools (name, slug, current_session, current_term, status) VALUES (?, ?, '2025/2026', '2nd Term', 'active')", ['Foreign Test ' + token, 'promotion-foreign-' + token]);
    foreignSchoolId = (await db.get('SELECT id FROM schools WHERE slug = ?', ['promotion-foreign-' + token])).id;
    await db.run("INSERT INTO sections (school_id, name, current_session, current_term) VALUES (?, ?, '2025/2026', '2nd Term')", [foreignSchoolId, 'Foreign Section ' + token]);
    const foreignSectionId = (await db.get('SELECT id FROM sections WHERE school_id = ? AND name = ?', [foreignSchoolId, 'Foreign Section ' + token])).id;
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [foreignSchoolId, foreignSectionId, 'Foreign Class ' + token]);
    const foreignClassId = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [foreignSchoolId, 'Foreign Class ' + token])).id;
    await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_session', '2025/2026')", [schoolId]);
    await db.run("INSERT INTO settings (school_id, key, value) VALUES (?, 'current_term', '2nd Term')", [schoolId]);

    const sectionIds = [];
    for (const name of ['Primary ' + token, 'Secondary ' + token]) {
      await db.run("INSERT INTO sections (school_id, name, current_session, current_term) VALUES (?, ?, '2025/2026', '2nd Term')", [schoolId, name]);
      sectionIds.push((await db.get('SELECT id FROM sections WHERE school_id = ? AND name = ?', [schoolId, name])).id);
    }
    const classIds = [];
    for (const [name, sectionId] of [['Grade 1 ' + token, sectionIds[0]], ['Grade 2 ' + token, sectionIds[0]], ['Secondary 1 ' + token, sectionIds[1]]]) {
      await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionId, name]);
      classIds.push((await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, name])).id);
    }
    const [sourceClass, targetClass, otherSectionClass] = classIds;
    const studentIds = [];
    for (const s of [
      { first: 'CurrentSession', admission: 'PROMO-CURRENT-' + token, session: '2025/2026' },
      { first: 'PreviousSession', admission: 'PROMO-PREVIOUS-' + token, session: '2024/2025' }
    ]) {
      await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, ?, 'Test', 'Other', '2015-01-01', ?, ?, 'active')", [schoolId, s.first, s.admission, sourceClass]);
      const id = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, s.admission])).id;
      studentIds.push(id);
      await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [id, sourceClass, s.session]);
    }
    const [currentStudent, previousStudent] = studentIds;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [currentStudent, otherSectionClass, '2026/2027']);

    const preview = response();
    await controller.previewPromotion({ schoolId, body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [sourceClass]: String(targetClass) } } }, preview);
    assert.strictEqual(preview.data.success, true);
    assert.strictEqual(preview.data.totalStudents, 1, 'Preview must exclude students enrolled only in a different session');
    assert.strictEqual(preview.data.preview[0].studentCount, 1);

    // Preview must reject invalid mappings instead of silently skipping them
    // or presenting an "Unknown Class" destination.
    const invalidPreviewMappings = [
      { mapping: { '999999999': String(targetClass) }, pattern: /invalid source class/i },
      { mapping: { [sourceClass]: '999999999' }, pattern: /invalid target class/i },
      { mapping: { [sourceClass]: String(foreignClassId) }, pattern: /invalid target class/i }
    ];
    for (const scenario of invalidPreviewMappings) {
      const invalidPreview = response();
      await controller.previewPromotion({
        schoolId,
        body: { source_session: '2025/2026', target_session: '2026/2027', mapping: scenario.mapping }
      }, invalidPreview);
      assert.strictEqual(invalidPreview.statusCode, 400, 'Invalid preview mapping must be rejected');
      assert.strictEqual(invalidPreview.data.success, false);
      assert.match(invalidPreview.data.message, scenario.pattern);
    }

    // Invalid targets must be rejected before student records or calendars change.
    for (const invalidTargetId of ['999999999', String(foreignClassId)]) {
      const invalid = response();
      await controller.processPromotion({
        schoolId, xhr: true,
        body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [sourceClass]: invalidTargetId } }
      }, invalid);
      assert.strictEqual(invalid.statusCode, 400, 'Invalid or foreign-school target classes must be rejected');
      assert.strictEqual(invalid.data.success, false);
      assert.match(invalid.data.message, /invalid target class/i);
      const unchangedStudent = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [currentStudent, schoolId]);
      assert.strictEqual(Number(unchangedStudent.current_class_id), Number(sourceClass), 'Invalid target must not change student class');
      const unchangedEnrollments = await db.all('SELECT class_id, session FROM student_enrollments WHERE student_id = ?', [currentStudent]);
      assert.strictEqual(unchangedEnrollments.length, 2, 'Invalid target must not alter enrollment history');
      const unchangedCalendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
      assert.strictEqual(unchangedCalendar.current_session, '2025/2026', 'Invalid target must not advance calendar');
      assert.strictEqual(unchangedCalendar.current_term, '2nd Term');
    }

    // Same-session individual promotion is valid, but must not reset the school's term.
    // Use a dedicated source class so this scenario cannot alter other tests' student fixtures.
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Same Session Source ' + token]);
    const sameSessionSourceClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Same Session Source ' + token])).id;
    await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, 'SameSession', 'Promotion', 'Other', '2015-01-01', ?, ?, 'active')", [schoolId, 'PROMO-SAME-SESSION-' + token, sameSessionSourceClass]);
    const sameSessionStudent = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, 'PROMO-SAME-SESSION-' + token])).id;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [sameSessionStudent, sameSessionSourceClass, '2025/2026']);
    const sameSession = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2025/2026', target_session: '2025/2026', mapping: { [sameSessionSourceClass]: String(targetClass) } }
    }, sameSession);
    assert.strictEqual(sameSession.statusCode, 200);
    assert.strictEqual(sameSession.data.success, true, 'Same-session individual promotion must remain allowed');
    assert.strictEqual(sameSession.data.calendarAdvanced, false);
    const movedStudent = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [sameSessionStudent, schoolId]);
    assert.strictEqual(Number(movedStudent.current_class_id), Number(targetClass), "Same-session promotion must update the student's class");
    const movedEnrollment = await db.get('SELECT class_id FROM student_enrollments WHERE student_id = ? AND session = ?', [sameSessionStudent, '2025/2026']);
    assert.strictEqual(Number(movedEnrollment.class_id), Number(targetClass), 'Same-session target enrollment must be recorded');
    const sameSessionCalendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
    assert.strictEqual(sameSessionCalendar.current_session, '2025/2026');
    assert.strictEqual(sameSessionCalendar.current_term, '2nd Term', 'Same-session promotion must not reset the current term');
    const sameSessionSettings = await db.get("SELECT value FROM settings WHERE school_id = ? AND key = 'current_term'", [schoolId]);
    assert.strictEqual(sameSessionSettings.value, '2nd Term', 'School term setting must remain unchanged');
    const sameSessionSections = await db.all('SELECT current_session, current_term FROM sections WHERE school_id = ?', [schoolId]);
    assert.ok(sameSessionSections.every(row => row.current_session === '2025/2026' && row.current_term === '2nd Term'), 'Same-session promotion must not change section calendars');

    // Invalid source class IDs must be rejected before any student or calendar writes.
    const invalidSource = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { '999999999': String(targetClass) } }
    }, invalidSource);
    assert.strictEqual(invalidSource.statusCode, 400);
    assert.strictEqual(invalidSource.data.success, false);
    assert.match(invalidSource.data.message, /invalid source class/i);
    const sourceUnchanged = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [currentStudent, schoolId]);
    assert.strictEqual(Number(sourceUnchanged.current_class_id), Number(sourceClass));
    const sourceCalendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
    assert.strictEqual(sourceCalendar.current_session, '2025/2026');
    assert.strictEqual(sourceCalendar.current_term, '2nd Term');

    // Empty and explicit "none" mappings are no-ops: they must not advance the calendar.
    for (const noOpMapping of [{}, { [sourceClass]: 'none' }]) {
      const noOp = response();
      await controller.processPromotion({
        schoolId, xhr: true,
        body: { source_session: '2025/2026', target_session: '2026/2027', mapping: noOpMapping }
      }, noOp);
      assert.strictEqual(noOp.statusCode, 200);
      assert.strictEqual(noOp.data.success, true);
      assert.strictEqual(noOp.data.calendarAdvanced, false);
      const unchanged = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
      assert.strictEqual(unchanged.current_session, '2025/2026');
      assert.strictEqual(unchanged.current_term, '2nd Term');
      const unchangedStudent = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [currentStudent, schoolId]);
      assert.strictEqual(Number(unchangedStudent.current_class_id), Number(sourceClass));
    }

    // Force the target enrollment INSERT to fail after earlier promotion writes.
    // This exercises transaction rollback without relying on SQLite FK settings.
    await db.run("CREATE TRIGGER promotion_test_force_failure BEFORE INSERT ON student_enrollments WHEN NEW.session = '2026/2027' AND NEW.class_id = " + Number(targetClass) + " BEGIN SELECT RAISE(ABORT, 'intentional promotion regression test failure'); END");
    const failed = response();
    await controller.processPromotion({ schoolId, xhr: true, body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [sourceClass]: String(targetClass) } } }, failed);
    assert.strictEqual(failed.statusCode, 500, 'Injected write failure must return HTTP 500');
    assert.strictEqual(failed.data.success, false);
    let student = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [currentStudent, schoolId]);
    assert.strictEqual(Number(student.current_class_id), Number(sourceClass), 'Student class update must roll back');
    let rows = await db.all('SELECT class_id, session FROM student_enrollments WHERE student_id = ?', [currentStudent]);
    assert.strictEqual(rows.length, 2, 'Failed promotion must not add or delete enrollment history');
    assert.ok(rows.some(r => Number(r.class_id) === Number(sourceClass) && r.session === '2025/2026'));
    assert.ok(rows.some(r => Number(r.class_id) === Number(otherSectionClass) && r.session === '2026/2027'));
    let calendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
    assert.strictEqual(calendar.current_session, '2025/2026', 'Calendar must not advance on failure');
    assert.strictEqual(calendar.current_term, '2nd Term');
    let setting = await db.get("SELECT value FROM settings WHERE school_id = ? AND key = 'current_session'", [schoolId]);
    assert.strictEqual(setting.value, '2025/2026');
    await db.run('DROP TRIGGER promotion_test_force_failure');

    const success = response();
    await controller.processPromotion({ schoolId, xhr: true, body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [sourceClass]: String(targetClass) } } }, success);
    assert.strictEqual(success.data.success, true, 'Valid promotion must succeed');
    student = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [currentStudent, schoolId]);
    assert.strictEqual(Number(student.current_class_id), Number(targetClass));
    rows = await db.all('SELECT class_id, session FROM student_enrollments WHERE student_id = ?', [currentStudent]);
    assert.ok(rows.some(r => Number(r.class_id) === Number(sourceClass) && r.session === '2025/2026'), 'Historical source enrollment must remain');
    assert.ok(rows.some(r => Number(r.class_id) === Number(targetClass) && r.session === '2026/2027'), 'Target enrollment must be added');
    assert.ok(rows.some(r => Number(r.class_id) === Number(otherSectionClass) && r.session === '2026/2027'), 'Other-section enrollment must remain');
    const oldStudent = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [previousStudent, schoolId]);
    assert.strictEqual(Number(oldStudent.current_class_id), Number(sourceClass), 'Previous-session-only student must not be promoted');
    assert.strictEqual(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND session = ?', [previousStudent, '2026/2027']), undefined);

    for (const id of sectionIds) {
      const section = await db.get('SELECT current_session, current_term FROM sections WHERE id = ? AND school_id = ?', [id, schoolId]);
      assert.strictEqual(section.current_session, '2026/2027');
      assert.strictEqual(section.current_term, '1st Term');
    }
    calendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
    assert.strictEqual(calendar.current_session, '2026/2027');
    assert.strictEqual(calendar.current_term, '1st Term');
    setting = await db.get("SELECT value FROM settings WHERE school_id = ? AND key = 'current_session'", [schoolId]);
    assert.strictEqual(setting.value, '2026/2027');
    const term = await db.get("SELECT value FROM settings WHERE school_id = ? AND key = 'current_term'", [schoolId]);
    assert.strictEqual(term.value, '1st Term');

    // Re-running the same promotion must not create duplicate target-session enrollments.
    // A stale enrollment in the source section is replaced, while another section's
    // target-session enrollment remains untouched.
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [currentStudent, sourceClass, '2026/2027']);
    const repeated = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [sourceClass]: String(targetClass) } }
    }, repeated);
    assert.strictEqual(repeated.statusCode, 200);
    assert.strictEqual(repeated.data.success, true, 'Repeated promotion should complete safely');
    const targetSectionEnrollments = await db.all(
      'SELECT class_id FROM student_enrollments WHERE student_id = ? AND session = ? AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?)',
      [currentStudent, '2026/2027', sectionIds[0], schoolId]
    );
    assert.strictEqual(targetSectionEnrollments.length, 1, 'Repeated promotion must leave exactly one enrollment in the target section');
    assert.strictEqual(Number(targetSectionEnrollments[0].class_id), Number(targetClass));
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [currentStudent, otherSectionClass, '2026/2027']), 'Repeated promotion must preserve the other-section enrollment');

    // Graduation changes student status and must not create a normal target-class enrollment.
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Graduation Source ' + token]);
    const graduationSourceClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Graduation Source ' + token])).id;
    await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, 'Graduating', 'Student', 'Other', '2010-01-01', ?, ?, 'active')", [schoolId, 'PROMO-GRADUATE-' + token, graduationSourceClass]);
    const graduatingStudent = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, 'PROMO-GRADUATE-' + token])).id;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [graduatingStudent, graduationSourceClass, '2026/2027']);
    const graduation = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2026/2027', target_session: '2027/2028', mapping: { [graduationSourceClass]: 'graduate' } }
    }, graduation);
    assert.strictEqual(graduation.statusCode, 200);
    assert.strictEqual(graduation.data.success, true, 'Graduation mapping should succeed');
    const graduated = await db.get('SELECT status FROM students WHERE id = ? AND school_id = ?', [graduatingStudent, schoolId]);
    assert.strictEqual(graduated.status, 'graduated');
    assert.strictEqual(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND session = ?', [graduatingStudent, '2027/2028']), undefined, 'Graduation must not create a normal target-session enrollment');

    console.log('[promotion-regression] Session filtering, enrollment history, cross-section preservation, rollback, and calendar tests passed.');
  } finally {
    await db.run('DROP TRIGGER IF EXISTS promotion_test_force_failure');
    if (schoolId !== null) {
      await db.run('DELETE FROM student_enrollments WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [schoolId]);
      await db.run('DELETE FROM students WHERE school_id = ?', [schoolId]);
      await db.run('DELETE FROM classes WHERE school_id = ?', [schoolId]);
      await db.run('DELETE FROM sections WHERE school_id = ?', [schoolId]);
      await db.run('DELETE FROM settings WHERE school_id = ?', [schoolId]);
      await db.run('DELETE FROM schools WHERE id = ?', [schoolId]);
    }
    if (foreignSchoolId !== null) {
      await db.run('DELETE FROM classes WHERE school_id = ?', [foreignSchoolId]);
      await db.run('DELETE FROM sections WHERE school_id = ?', [foreignSchoolId]);
      await db.run('DELETE FROM schools WHERE id = ?', [foreignSchoolId]);
    }
  }
}
run().catch(err => { console.error('[promotion-regression] Failed:', err); process.exitCode = 1; });
