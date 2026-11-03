'use strict';

// Static regression guard: section-specific report paths must constrain results
// and class rankings to the selected class's subject assignments. No DB is opened.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'resultController.js'), 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf(`const ${name} = async (req, res) => {`);
  assert.notStrictEqual(start, -1, `Missing controller function ${name}`);
  const end = nextName
    ? source.indexOf(`const ${nextName} = async (req, res) => {`, start + 1)
    : source.length;
  assert.notStrictEqual(end, -1, `Missing following controller function ${nextName}`);
  return source.slice(start, end === -1 ? source.length : end);
}

const report = functionSource('getReportCard', 'getCumulativeReport');
const cumulative = functionSource('getCumulativeReport', 'getBulkReport');
const bulk = functionSource('getBulkReport', 'getBulkCumulative');
const bulkCumulative = functionSource('getBulkCumulative', 'getTraitsForm');

for (const [name, body] of [
  ['individual report card', report],
  ['individual cumulative report', cumulative],
  ['bulk report cards', bulk],
  ['bulk cumulative reports', bulkCumulative]
]) {
  assert.match(body, /class_id = \?/, `${name} must filter result rows by explicit class ownership`);
  assert.match(body, /status IN \('approved', 'published'\)/,
    `${name} must expose only approved or published result rows`);
}

assert.match(report, /r2\.class_id = \?/,
  'Individual subject rankings must compare marks from the same class only');
assert.match(bulk, /r2\.class_id = \?/,
  'Bulk subject rankings must compare marks from the same class only');
assert.match(report, /affective_psychomotor[\s\S]*?class_id = \?/,
  'Individual report traits must be scoped to the selected class');
assert.match(bulk, /affective_psychomotor[\s\S]*?class_id = \?/,
  'Bulk report traits must be scoped to the selected class');

assert.match(report, /multiple published class reports for this session/i,
  'Individual report cards must not silently choose an arbitrary enrollment');
assert.match(cumulative, /multiple published class reports for this session/i,
  'Individual cumulative reports must not silently choose an arbitrary enrollment');
assert.match(report, /class_id = \? AND status = 'Present'/,
  'Individual report attendance must be scoped to the selected class');
assert.match(bulk, /class_id = \? AND status = 'Present'/,
  'Bulk report attendance must be scoped to the selected class');


const academicReportSource = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'reporting', 'academicReportController.js'),
  'utf8'
);

const academicBroadsheet = academicReportSource.slice(academicReportSource.indexOf('const getBroadsheet'), academicReportSource.indexOf('const getSubjectAnalysis'));
const academicAnalysis = academicReportSource.slice(academicReportSource.indexOf('const getSubjectAnalysis'), academicReportSource.indexOf('const getTopPerformers'));
const academicTop = academicReportSource.slice(academicReportSource.indexOf('const getTopPerformers'));

for (const [name, body] of [
  ['broadsheet', academicBroadsheet],
  ['top performers', academicTop]
]) {
  assert.match(body, /r\.class_id = \?/,
    `${name} must restrict result rows to the selected class`);
}
assert.match(academicAnalysis, /r\.class_id = sa\.class_id/,
  'Subject analysis must join results to the class captured at result entry');
assert.match(academicAnalysis, /sa\.class_id = \?/,
  'Subject analysis must restrict assigned subjects to the selected class');
for (const [name, body] of [
  ['broadsheet', academicBroadsheet],
  ['subject analysis', academicAnalysis],
  ['top performers', academicTop]
]) {
  assert.match(body, /status IN \('approved', 'published'\)/,
    `${name} must exclude draft and submitted result rows`);
  assert.match(body, /canAccessClass\(class_id\)/,
    `${name} must authorize the requested class, not just the dropdown list`);
}
assert.doesNotMatch(academicBroadsheet, /JOIN student_enrollments se ON r\.student_id = se\.student_id/,
  'Broadsheet result ownership must not depend on current enrollment');
assert.doesNotMatch(academicAnalysis, /JOIN student_enrollments se ON r\.student_id = se\.student_id/,
  'Subject analysis result ownership must not depend on current enrollment');
assert.doesNotMatch(academicTop, /JOIN student_enrollments se ON s\.id = se\.student_id/,
  'Top-performer result ownership must not depend on current enrollment');
assert.match(academicAnalysis, /eligible_students_count/,
  'Subject analysis must expose the eligible cohort denominator');
assert.match(academicAnalysis, /subject_assignments/,
  'Subject analysis must include the subjects assigned to the class, even when no marks are published');
assert.match(academicTop, /HAVING COUNT\(DISTINCT r\.subject_id\) = \?/,
  'Top-performer rankings must require a complete set of assigned subjects');
assert.match(academicTop, /\[3, 5, 10\]\.includes\(requestedLimit\)/,
  'Top-performer limit must be restricted to supported options');

const cumulativeTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'cumulative_content.ejs'), 'utf8');
assert.match(cumulativeTemplate, /s\.terms\[termName\] !== null && s\.terms\[termName\] !== undefined/,
  'Cumulative calculations must count an explicit zero score as a present result');
assert.match(cumulativeTemplate, /row\.terms\['1st Term'\] !== undefined && row\.terms\['1st Term'\] !== null/,
  'Cumulative term cells must display a zero score instead of a dash');

process.stdout.write('PASS: Report-card publication, historical ownership, section isolation, and zero-score guards\\n');
