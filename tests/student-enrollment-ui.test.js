'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const template = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'students', 'enroll.ejs'),
    'utf8'
);
const controller = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'studentController.js'),
    'utf8'
);

// Keep all form styling scoped so this page cannot unexpectedly restyle shared controls.
assert.match(template, /\.student-enroll-page\s*\{/);
assert.doesNotMatch(template, /(^|\n)\s*(?:label|input|select)\s*\{/,
    'Enrollment page must not apply unscoped global form styles');
assert.match(template, /@media\s*\(max-width:\s*640px\)/,
    'Enrollment form must have a mobile layout');
assert.match(template, /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'Enrollment fields must collapse to one column on small screens');

// Required identity fields remain browser-validated and associated with visible labels.
for (const field of ['first_name', 'last_name', 'gender', 'dob']) {
    assert.match(template, new RegExp('for="' + field + '"'));
    assert.match(template, new RegExp('name="' + field + '"[^>]*required|name="' + field + '"[^>]*>[\\s\\S]{0,100}required'));
}

// Preserve all existing enrollment field names and the section-specific assignment model.
for (const field of [
    'phone', 'email', 'address', 'parent_phone', 'parent_phone_alt',
    'parent_email', 'parent_address', 'passport', 'current_class_id'
]) {
    assert.match(template, new RegExp('name="' + field + '"'));
}
assert.match(template, /section_\\$\{sec\.id\}_class_id/,
    'Each section must retain its own class selector');
assert.match(template, /data-crop="square"/,
    'Passport photo crop integration must remain enabled');

// Submission feedback must prevent accidental double submission without bypassing native validation.
assert.match(template, /form\.checkValidity\(\)/);
assert.match(template, /form\.reportValidity\(\)/);
assert.match(template, /submitButton\.disabled = true/);
assert.match(template, /aria-live="polite"/);

// Server-provided errors must be passed to the template and rendered with EJS escaping.
assert.match(controller, /error:\s*req\.query\.error\s*\|\|\s*''/);
assert.match(template, /<div class="student-enroll-alert" role="alert"/);
assert.match(template, /<%= error %>/);
assert.doesNotMatch(template, /<%-\s*error\s*%>/,
    'Enrollment error text must use escaped EJS output');

console.log('Student enrollment UI checks passed.');
