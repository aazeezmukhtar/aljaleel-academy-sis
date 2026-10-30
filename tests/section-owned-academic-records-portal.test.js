'use strict';

// Static guards for class/section isolation in student-facing and trait workflows.
// This test reads source files only and never opens a school database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const portal = read('controllers/portalController.js');
const results = read('controllers/resultController.js');
const student = read('controllers/studentController.js');
const portalView = read('views/portal/index.ejs');
const traitsView = read('views/results/traits.ejs');
const profileView = read('views/students/view.ejs');

const termly = portal.slice(portal.indexOf('exports.viewTermlyResult'), portal.indexOf('exports.viewCumulativeResult'));
assert.match(termly, /class_id/);
assert.match(termly, /student_enrollments[\s\S]*?student_id = \?[\s\S]*?class_id = \?[\s\S]*?session = \?/);
assert.match(termly, /class_id = \?[\s\S]*?status IN \('approved', 'published'\)/);

const cumulative = portal.slice(portal.indexOf('exports.viewCumulativeResult'), portal.indexOf('exports.getProfile'));
assert.match(cumulative, /class_id/);
assert.match(cumulative, /student_enrollments[\s\S]*?student_id = \?[\s\S]*?class_id = \?[\s\S]*?session = \?/);
assert.match(cumulative, /class_id = \?[\s\S]*?status IN \('approved', 'published'\)/);

const dashboardQuery = portal.slice(portal.indexOf('const results = await db.all'), portal.indexOf('// Fetch fee payments'));
assert.match(dashboardQuery, /r\.class_id/);
assert.match(dashboardQuery, /GROUP BY r\.class_id/);

const traitForm = results.slice(results.indexOf('const getTraitsForm'), results.indexOf('const saveTraits'));
assert.match(traitForm, /ap\.class_id = \?/);
const traitSave = results.slice(results.indexOf('const saveTraits'), results.indexOf('const approveResults'));
assert.match(traitSave, /INSERT INTO affective_psychomotor \(student_id, class_id/);
assert.match(traitsView, /class_id: '<%= filters\.class_id %>'/);

const publish = results.slice(results.indexOf('const publishBulkResults'));
assert.match(publish, /if \(!class_id \|\| !term \|\| !session\)/);
assert.doesNotMatch(publish, /WHERE term = \? AND session = \?[\s\S]*?student_id IN/);

const profileHistory = student.slice(student.indexOf('const academicTerms = await db.all'), student.indexOf('const success ='));
assert.match(profileHistory, /r\.class_id/);
assert.match(profileView, /&class_id=<%= term\.class_id %>/);
assert.match(portalView, /&class_id=<%= result\.class_id %>/);
assert.doesNotMatch(portalView, /class_name=<%= encodeURIComponent\(ec\.class_name\) %>/);

process.stdout.write('PASS: student portal, profile, trait and publication class-isolation guards\\n');
