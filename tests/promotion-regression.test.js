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
