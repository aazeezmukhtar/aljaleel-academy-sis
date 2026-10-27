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

    // Preview should explain invalid source/destination mappings instead of silently
    // skipping them or showing "Unknown Class". It must not write any data.
    const invalidPreview = response();
    await controller.previewPromotion({
      schoolId,
      body: {
        source_session: '2025/2026',
        target_session: '2026/2027',
        mapping: { '999999999': String(targetClass), [sourceClass]: '999999999', [sourceClass + 'x']: String(targetClass) }
      }
    }, invalidPreview);
    assert.strictEqual(invalidPreview.statusCode, 200, 'Preview warnings should not cause a server error');
    assert.strictEqual(invalidPreview.data.success, true);
    assert.ok(Array.isArray(invalidPreview.data.warnings));
    assert.strictEqual(invalidPreview.data.warnings.length, 3, 'Each invalid mapping should have a clear warning');
    assert.strictEqual(invalidPreview.data.preview.length, 0, 'Invalid mappings must not appear as valid preview rows');
    const previewSafetyStudent = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [currentStudent, schoolId]);
    assert.strictEqual(Number(previewSafetyStudent.current_class_id), Number(sourceClass), 'Preview must not change student records');
    const previewSafetyCalendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
    assert.strictEqual(previewSafetyCalendar.current_session, '2025/2026');
    assert.strictEqual(previewSafetyCalendar.current_term, '2nd Term');

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

    // Cross-section promotion must be rejected before any writes. A student may have
    // legitimate enrollments in both sections, but promotion mappings must not
    // create an Academy enrollment from a Tahfeez source (or vice versa).
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Cross Section Source ' + token]);
    const crossSectionSourceClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Cross Section Source ' + token])).id;
    await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, 'CrossSection', 'Promotion', 'Other', '2015-01-01', ?, ?, 'active')", [schoolId, 'PROMO-CROSS-SECTION-' + token, crossSectionSourceClass]);
    const crossSectionStudent = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, 'PROMO-CROSS-SECTION-' + token])).id;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [crossSectionStudent, crossSectionSourceClass, '2025/2026']);
    const crossSectionPreview = response();
    await controller.previewPromotion({
      schoolId,
      body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [crossSectionSourceClass]: String(otherSectionClass) } }
    }, crossSectionPreview);
    assert.strictEqual(crossSectionPreview.data.success, true);
    assert.strictEqual(crossSectionPreview.data.preview.length, 0, 'Preview must exclude cross-section mappings');
    assert.ok(crossSectionPreview.data.warnings.some(w => /crosses sections/i.test(w)), 'Preview must explain the cross-section mapping');

    const crossSection = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [crossSectionSourceClass]: String(otherSectionClass) } }
    }, crossSection);
    assert.strictEqual(crossSection.statusCode, 400);
    assert.strictEqual(crossSection.data.success, false);
    assert.match(crossSection.data.message, /same section/i);
    const crossSectionCurrentClass = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [crossSectionStudent, schoolId]);
    assert.strictEqual(Number(crossSectionCurrentClass.current_class_id), Number(crossSectionSourceClass), 'Rejected cross-section mapping must not change current class');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [crossSectionStudent, crossSectionSourceClass, '2025/2026']), 'Source enrollment must remain');
    assert.ok(!(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND session = ?', [crossSectionStudent, '2026/2027'])), 'Rejected mapping must not create a target enrollment');
    const crossSectionCalendar = await db.get('SELECT current_session, current_term FROM schools WHERE id = ?', [schoolId]);
    assert.strictEqual(crossSectionCalendar.current_session, '2025/2026');
    assert.strictEqual(crossSectionCalendar.current_term, '2nd Term');

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

    // A stale extra target-session enrollment is ambiguous and must not be silently
    // deleted or replaced by a repeated promotion.
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [currentStudent, sourceClass, '2026/2027']);
    const repeated = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2025/2026', target_session: '2026/2027', mapping: { [sourceClass]: String(targetClass) } }
    }, repeated);
    assert.strictEqual(repeated.statusCode, 500);
    assert.strictEqual(repeated.data.success, false, 'Ambiguous target placements must stop promotion');
    assert.match(repeated.data.message, /multiple class enrollments/i);
    const targetSectionEnrollments = await db.all(
      'SELECT class_id FROM student_enrollments WHERE student_id = ? AND session = ? AND class_id IN (SELECT id FROM classes WHERE section_id = ? AND school_id = ?)',
      [currentStudent, '2026/2027', sectionIds[0], schoolId]
    );
    assert.strictEqual(targetSectionEnrollments.length, 2, 'Both conflicting target-section enrollments must remain for manual reconciliation');
    assert.ok(targetSectionEnrollments.some(row => Number(row.class_id) === Number(sourceClass)));
    assert.ok(targetSectionEnrollments.some(row => Number(row.class_id) === Number(targetClass)));
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [currentStudent, otherSectionClass, '2026/2027']), 'Failed repeated promotion must preserve the other-section enrollment');

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

    // Selective promotion: selected students advance; unchecked students repeat
    // in the same class for the target session. Both retain source-session history.
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Selective Source ' + token]);
    const selectiveSourceClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Selective Source ' + token])).id;
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Selective Target ' + token]);
    const selectiveTargetClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Selective Target ' + token])).id;
    const selectiveStudentIds = [];
    for (const [firstName, admission] of [
      ['AdvanceSelected', 'PROMO-SELECTED-' + token],
      ['RepeatUnselected', 'PROMO-REPEATER-' + token]
    ]) {
      await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, ?, 'Selective', 'Other', '2015-01-01', ?, ?, 'active')", [schoolId, firstName, admission, selectiveSourceClass]);
      const id = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, admission])).id;
      selectiveStudentIds.push(id);
      await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [id, selectiveSourceClass, '2026/2027']);
    }
    const [selectedStudent, repeaterStudent] = selectiveStudentIds;
    const selective = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: {
        source_session: '2026/2027',
        target_session: '2027/2028',
        mapping: { [selectiveSourceClass]: String(selectiveTargetClass) },
        promote_student_ids: { [selectiveSourceClass]: [selectedStudent] }
      }
    }, selective);
    assert.strictEqual(selective.statusCode, 200);
    assert.strictEqual(selective.data.success, true, 'Selective promotion should succeed');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [selectedStudent, selectiveTargetClass, '2027/2028']), 'Selected student must advance to the mapped target class');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [repeaterStudent, selectiveSourceClass, '2027/2028']), 'Unchecked student must repeat the source class in the target session');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [selectedStudent, selectiveSourceClass, '2026/2027']), 'Selected student source-session history must remain');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [repeaterStudent, selectiveSourceClass, '2026/2027']), 'Repeater source-session history must remain');
    const repeaterCurrentClass = await db.get('SELECT current_class_id FROM students WHERE id = ? AND school_id = ?', [repeaterStudent, schoolId]);
    assert.strictEqual(Number(repeaterCurrentClass.current_class_id), Number(selectiveSourceClass), 'Repeater current class must remain unchanged');

    // Selective graduation: selected students graduate; unchecked students repeat.
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Selective Graduation ' + token]);
    const selectiveGraduationClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Selective Graduation ' + token])).id;
    const graduationIds = [];
    for (const [firstName, admission] of [
      ['GraduateSelected', 'PROMO-SELECTIVE-GRAD-' + token],
      ['GraduateRepeater', 'PROMO-SELECTIVE-REPEAT-' + token]
    ]) {
      await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, ?, 'Selective', 'Other', '2010-01-01', ?, ?, 'active')", [schoolId, firstName, admission, selectiveGraduationClass]);
      const id = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, admission])).id;
      graduationIds.push(id);
      await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [id, selectiveGraduationClass, '2027/2028']);
    }
    const [selectedGraduate, graduationRepeater] = graduationIds;
    const selectiveGraduation = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: {
        source_session: '2027/2028',
        target_session: '2028/2029',
        mapping: { [selectiveGraduationClass]: 'graduate' },
        promote_student_ids: { [selectiveGraduationClass]: [selectedGraduate] }
      }
    }, selectiveGraduation);
    assert.strictEqual(selectiveGraduation.statusCode, 200);
    assert.strictEqual(selectiveGraduation.data.success, true, 'Selective graduation should succeed');
    assert.strictEqual((await db.get('SELECT status FROM students WHERE id = ?', [selectedGraduate])).status, 'graduated');
    assert.strictEqual((await db.get('SELECT status FROM students WHERE id = ?', [graduationRepeater])).status, 'active');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [graduationRepeater, selectiveGraduationClass, '2028/2029']), 'Unchecked graduation student must repeat in the target session');


    // Invalid checkbox selections must fail closed before any partial writes.
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Invalid Selection Source ' + token]);
    const invalidSelectionClass = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Invalid Selection Source ' + token])).id;
    await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, 'Invalid', 'Selection', 'Other', '2015-01-01', ?, ?, 'active')", [schoolId, 'PROMO-INVALID-SELECTION-' + token, invalidSelectionClass]);
    const invalidSelectionStudent = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, 'PROMO-INVALID-SELECTION-' + token])).id;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [invalidSelectionStudent, invalidSelectionClass, '2028/2029']);
    const invalidSelection = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: {
        source_session: '2028/2029',
        target_session: '2029/2030',
        mapping: { [invalidSelectionClass]: String(targetClass) },
        promote_student_ids: { [invalidSelectionClass]: [currentStudent] }
      }
    }, invalidSelection);
    assert.strictEqual(invalidSelection.statusCode, 500, 'Selection IDs outside the mapped source cohort must be rejected');
    assert.strictEqual(invalidSelection.data.success, false);
    assert.match(invalidSelection.data.message, /outside its mapped source class\/session/i);
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [invalidSelectionStudent, invalidSelectionClass, '2028/2029']), 'Rejected selection must preserve source enrollment');
    assert.strictEqual(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND session = ?', [invalidSelectionStudent, '2029/2030']), undefined, 'Rejected selection must not create a target enrollment');

    // Graduation must stop when the selected student remains enrolled in another section.
    await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, 'Dual', 'Section', 'Other', '2010-01-01', ?, ?, 'active')", [schoolId, 'PROMO-GRAD-DUAL-SECTION-' + token, selectiveGraduationClass]);
    const dualSectionGraduate = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, 'PROMO-GRAD-DUAL-SECTION-' + token])).id;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [dualSectionGraduate, selectiveGraduationClass, '2028/2029']);
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [dualSectionGraduate, otherSectionClass, '2029/2030']);
    const blockedGraduation = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: { source_session: '2028/2029', target_session: '2029/2030', mapping: { [selectiveGraduationClass]: 'graduate' } }
    }, blockedGraduation);
    assert.strictEqual(blockedGraduation.statusCode, 500, 'Graduation must be blocked for cross-section students');
    assert.match(blockedGraduation.data.message, /another section/i);
    assert.strictEqual((await db.get('SELECT status FROM students WHERE id = ? AND school_id = ?', [dualSectionGraduate, schoolId])).status, 'active', 'Blocked graduation must not change global student status');
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [dualSectionGraduate, otherSectionClass, '2029/2030']), 'Blocked graduation must preserve other-section enrollment');

    // An unchecked repeater must not overwrite a different pre-existing target-session placement.
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Repeater Conflict Source ' + token]);
    const repeaterConflictSource = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Repeater Conflict Source ' + token])).id;
    await db.run('INSERT INTO classes (school_id, section_id, name) VALUES (?, ?, ?)', [schoolId, sectionIds[0], 'Repeater Conflict Existing ' + token]);
    const repeaterConflictExisting = (await db.get('SELECT id FROM classes WHERE school_id = ? AND name = ?', [schoolId, 'Repeater Conflict Existing ' + token])).id;
    await db.run("INSERT INTO students (school_id, first_name, last_name, gender, dob, admission_number, current_class_id, status) VALUES (?, 'Repeater', 'Conflict', 'Other', '2015-01-01', ?, ?, 'active')", [schoolId, 'PROMO-REPEATER-CONFLICT-' + token, repeaterConflictSource]);
    const repeaterConflictStudent = (await db.get('SELECT id FROM students WHERE school_id = ? AND admission_number = ?', [schoolId, 'PROMO-REPEATER-CONFLICT-' + token])).id;
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [repeaterConflictStudent, repeaterConflictSource, '2028/2029']);
    await db.run('INSERT INTO student_enrollments (student_id, class_id, session) VALUES (?, ?, ?)', [repeaterConflictStudent, repeaterConflictExisting, '2029/2030']);
    const repeaterConflict = response();
    await controller.processPromotion({
      schoolId, xhr: true,
      body: {
        source_session: '2028/2029',
        target_session: '2029/2030',
        mapping: { [repeaterConflictSource]: String(targetClass) },
        promote_student_ids: { [repeaterConflictSource]: [] }
      }
    }, repeaterConflict);
    assert.strictEqual(repeaterConflict.statusCode, 500, 'A conflicting repeater placement must stop the whole operation');
    assert.match(repeaterConflict.data.message, /different enrollment in the target session/i);
    assert.ok(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [repeaterConflictStudent, repeaterConflictExisting, '2029/2030']), 'Existing target placement must remain untouched');
    assert.strictEqual(await db.get('SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?', [repeaterConflictStudent, repeaterConflictSource, '2029/2030']), undefined, 'Conflicting repeater must not receive a second target enrollment');

    console.log('[promotion-regression] Session filtering, selective promotion/repeaters, enrollment history, cross-section preservation, rollback, and calendar tests passed.');
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
