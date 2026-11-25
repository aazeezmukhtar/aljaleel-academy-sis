'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const controller = read('controllers/resultController.js');
const manager = read('views/results/manager.ejs');
const reportController = read('controllers/reporting/academicReportController.js');
const broadsheet = read('views/reports/academic/broadsheet.ejs');

const save = controller.slice(controller.indexOf('const saveResults'), controller.indexOf('const getReportCard'));
assert.match(save, /LOWER\\(COALESCE\\(st\\.status, ''\\)\\) IN \\('active', ''\\)/,
  'Result entry must use active and legacy NULL-status students');
assert.match(save, /normalizedStatus === 'submitted'[\\s\\S]*activeStudentIds\.some/,
  'Submission must contain exactly the active student cohort');
assert.match(save, /const scoreValue = value => value === ''[\\s\\S]*?\? null/,
  'Blank score components must persist as NULL, not zero');
assert.match(save, /computeResult/,
  'Result saving must use the shared partial-assessment calculation helper');
assert.match(save, /computeResult\\(ca1, caCount === 1 \\? null : ca2, exam\\)/,
  'Blank configured assessments must be ignored while available marks are totalled');

const approval = controller.slice(controller.indexOf('const approveResults'), controller.indexOf('const lockResults'));
const locking = controller.slice(controller.indexOf('const lockResults'), controller.indexOf('const unlockResults'));
const publishing = controller.slice(controller.indexOf('const publishBulkResults'), controller.indexOf('module.exports'));
for (const [name, body] of [['approval', approval], ['locking', locking], ['publishing', publishing]]) {
  assert.match(body, /LOWER\\(COALESCE\\(st\\.status, ''\\)\\) IN \\('active', ''\\)/,
    `${name} cohort count must exclude inactive students`);
  assert.match(body, /LOWER\\(COALESCE\\(status,''\\)\\) IN \\('active',''\\)/,
    `${name} state transition must not mutate inactive students`);
}

assert.match(manager, /CA_COUNT:/);
assert.match(manager, /value="<%= s\.ca1 \?\? '' %>"/);
assert.match(manager, /value="<%= s\.exam \?\? '' %>"/);
assert.match(manager, /const complete = rawCa1 !== '' && rawExam !== ''/);
assert.match(manager, /if \(!complete\)[\\s\\S]*totalCell\.textContent = '-'/);

const broadsheetHandler = reportController.slice(reportController.indexOf('const getBroadsheet'), reportController.indexOf('const getSubjectAnalysis'));
assert.match(broadsheetHandler, /'draft', 'submitted', 'approved', 'locked', 'published'/);
assert.match(broadsheetHandler, /status: r\.status/);
assert.match(broadsheetHandler, /value !== null && value !== undefined/);
assert.match(broadsheet, /result\.status \|\| 'draft'/);
assert.match(broadsheet, /Total \(Scored\)/);

process.stdout.write('PASS: Active-cohort workflow, absent-score, and broadsheet regression checks\\n');
