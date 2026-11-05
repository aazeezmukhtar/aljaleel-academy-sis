'use strict';

process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../utils/db');
const studentController = require('../controllers/studentController');

(async () => {
  const originalRun = db.run;
  let writes = 0;
  db.run = async () => { writes++; throw new Error('Student deletion must never write to the database'); };
  try {
    let statusCode = 200;
    let payload;
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; }
    };
    await studentController.deleteStudent({ params: { id: '123' }, schoolId: 1 }, res);
    assert.strictEqual(statusCode, 410, 'Legacy delete endpoint must be permanently disabled');
    assert.strictEqual(payload.success, false);
    assert.match(payload.message, /graduation or departure/i);
    assert.strictEqual(writes, 0, 'Disabled endpoint must not execute database writes');
  } finally {
    db.run = originalRun;
  }

  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'studentRoutes.js'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'views', 'students', 'view.ejs'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'studentController.js'), 'utf8');
  assert.match(routes, /router\.post\('\/delete\/:id',\s*isAdmin,\s*studentController\.deleteStudent\)/,
    'Legacy endpoint remains Admin-protected and returns the disabled response');
  assert.doesNotMatch(controller, /DELETE FROM (attendance|results|payments|student_fees|affective_psychomotor|class_posts|student_health|student_enrollments|students)/i,
    'Student controller must not contain destructive student-record deletion statements');
  assert.doesNotMatch(profile, /deleteStudent\(|>\s*Delete\s*</i,
    'Student profile must not offer a permanent delete action');

  console.log('[student-delete-disabled] Legacy deletion endpoint is disabled and student records are preserved.');
})().catch(error => {
  console.error('[student-delete-disabled] Test failed:', error);
  process.exitCode = 1;
});
