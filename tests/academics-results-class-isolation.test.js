'use strict';

// Static regression guards for the student Academics Results class context.
// This test reads source only and never connects to a school database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'portalController.js'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'portal', 'academics', 'results.ejs'), 'utf8');
const start = controller.indexOf('exports.getAcademicsResults = async (req, res) => {');
const end = controller.indexOf('exports.getAcademicsClassBoard =', start);
assert.notStrictEqual(start, -1, 'Academics results handler must exist');
assert.notStrictEqual(end, -1, 'Academics results handler boundary must exist');
const body = controller.slice(start, end);

assert.match(body, /SELECT DISTINCT r\.session, r\.term, r\.class_id/);
assert.match(body, /LEFT JOIN classes c ON c\.id = r\.class_id/);
assert.match(body, /req\.query\.class_id/);
assert.match(body, /r\.class_id = \?/);
assert.match(body, /r\.class_id IS NULL/);
assert.match(body, /AND \$\{ownershipFilter\}/);
assert.match(body, /r\.class_id = \?[\s\S]*?GROUP BY r\.student_id/);
assert.match(body, /Compare only with the immediately preceding published period in this same class/);
assert.match(body, /c\.name AS class_name/);
assert.match(view, /name="class_id"/);
assert.match(view, /selectedClassPeriods/);
assert.match(view, /class_id=<%= encodeURIComponent\(selectedClassId\) %>/);
assert.match(view, /Legacy record — printable report unavailable/);
assert.match(view, /Legacy record — cumulative report unavailable/);
assert.doesNotMatch(view, /class_name=<%= encodeURIComponent\(ec\.class_name\) %>/);

process.stdout.write('PASS: Academics results are isolated by historical class ownership\\n');
