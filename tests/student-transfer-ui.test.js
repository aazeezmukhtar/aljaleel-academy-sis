'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const profile = read('views/students/view.ejs');
const transfer = read('views/students/transfer.ejs');
const controller = read('controllers/studentController.js');
const routes = read('routes/studentRoutes.js');

assert.match(profile, /href="\/students\/transfer\/<%= student\.id %>"/, 'Student profile must link to the dedicated transfer window.');
assert.doesNotMatch(profile, /openPromoteModal|promoteSourceClass|promoteTargetClass/, 'The obsolete profile-level promotion modal must be removed.');
assert.match(transfer, /data-section-id="<%= enr\.section_id %>"/, 'Source placement must expose its section for filtering.');
assert.match(transfer, /String\(item\.section_id\) === String\(sourceOption\.dataset\.sectionId\)/, 'Destination classes must be filtered by the selected section using normalized IDs.');
assert.match(transfer, /id="transferDate"/, 'Transfer form must capture an effective date.');
assert.match(transfer, /id="transferReason"/, 'Transfer form must capture a reason.');
assert.match(controller, /eventType: 'internal_transfer'/, 'Controller must record the internal_transfer event.');
assert.match(controller, /await db\.transaction\(async client =>/, 'Assignment and legacy class-pointer changes must share a transaction.');
assert.match(controller, /source\.section_name === 'Academy'/, 'Tahfeez transfer must not overwrite the legacy Academy class pointer.');
assert.match(routes, /router\.get\('\/transfer\/:id', isAdmin, studentController\.getStudentTransferPage\)/, 'Transfer page must be Admin-only.');
assert.match(routes, /router\.post\('\/transfer\/:id', isAdmin, studentController\.transferStudent\)/, 'Transfer action must be Admin-only.');

console.log('[student-transfer-ui] Dedicated transfer entry point, section filtering, required fields and admin-only routes passed.');
