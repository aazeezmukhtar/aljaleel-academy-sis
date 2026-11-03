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
assert.match(template, /\.student-class-inline\s*\{[^}]*overflow-x:\s*auto/s,
    'Long class lists should remain accessible through horizontal scrolling.');
assert.match(template, /\.student-class-inline\s*\{[^}]*max-width:\s*100%/s,
    'The class list should stay within the available cell width.');

console.log('Student class inline layout checks passed.');
