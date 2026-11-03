const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const template = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'students', 'index.ejs'),
    'utf8'
);

assert.match(template, /class="badge student-class-inline"/,
    'Server-rendered class assignments should use the no-wrap class badge.');
assert.match(template, /student-class-inline[^\n]*\$\{escapeHtml\(s\.class_name\)\}/,
    'Dynamically filtered student rows should use the same no-wrap class badge.');
assert.match(template, /\.student-class-inline\s*\{[^}]*white-space:\s*nowrap\s*!important/s,
    'Class assignments must never wrap onto a second line.');
assert.match(template, /\.student-class-inline\s*\{[^}]*overflow:\s*visible\s*!important/s,
    'Class assignments must not be placed in a scrollable container.');
assert.match(template, /\.student-class-inline\s*\{[^}]*max-width:\s*none\s*!important/s,
    'The class list should use its natural width instead of being clipped.');
assert.match(template, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/,
    'The mobile student card should allocate natural width to the class list beside the ID.');

console.log('Student class inline layout checks passed.');
