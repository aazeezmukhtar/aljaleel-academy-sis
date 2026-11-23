'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const routes = read('routes/resultRoutes.js');
const controller = read('controllers/resultController.js');
const view = read('views/results/tracking.ejs');
const dashboard = read('views/results/index.ejs');
const manager = read('views/results/manager.ejs');
const css = read('public/css/acadme-results.css');
const tokens = read('public/css/acadme-tokens.css');

assert.match(routes, /router\.get\('\/tracking', resultController\.getResultWorkflowTracking\)/);
assert.match(controller, /const getResultWorkflowTracking = async \(req, res\) =>/);
assert.match(controller, /res\.render\('results\/tracking'/);
assert.match(controller, /c\.school_id = \? AND sub\.school_id = \?/);
assert.match(controller, /own\.teacher_id = \?/);
assert.match(controller, /ca\.staff_id = \?/);
assert.match(controller, /c\.form_teacher_id = \?/);
assert.match(controller, /selectedSection/);
for (const status of ['draft','submitted','approved','locked','published']) {
  assert.ok(controller.includes(`= '${status}'`), `Tracking query must count ${status} results`);
}
assert.match(controller, /student_enrollments/);
assert.match(controller, /COUNT\(DISTINCT enrolled\.id\) AS expected_count/);
assert.match(controller, /COUNT\(DISTINCT r\.student_id\) AS recorded_count/);
const trackingHandler = controller.slice(controller.indexOf('const getResultWorkflowTracking'), controller.indexOf('const getResultManager'));
assert.doesNotMatch(trackingHandler, /\b(?:INSERT|UPDATE|DELETE)\s+results\b/i,
  'Workflow tracking must remain read-only');

assert.match(dashboard, /href="\/results\/tracking"/);
assert.match(manager, /href="\/results\/tracking"/);
for (const status of ['Draft','Submitted','Approved','Locked','Published']) {
  assert.ok(view.includes(status), `Tracking page must display ${status}`);
}
assert.match(view, /name="session"/);
assert.match(view, /name="term"/);
assert.match(view, /name="section_id"/);
assert.match(view, /\/results\/manage\?class_id=/);
assert.match(view, /<progress[\s>]/);
ejs.compile(view, { filename: path.join(__dirname, '..', 'views/results/tracking.ejs') });

const defined = new Set([...tokens.matchAll(/(--acm-[\w-]+)\s*:/g)].map(match => match[1]));
for (const match of css.matchAll(/var\((--acm-[\w-]+)/g)) {
  assert.ok(defined.has(match[1]), `Undefined AcadMe token: ${match[1]}`);
}
assert.match(css, /@media\(max-width:640px\)/);
assert.match(css, /prefers-reduced-motion:reduce/);

console.log('Result workflow tracking checks passed.');
