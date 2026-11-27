'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const { sanitizeRichText } = require('../utils/richText');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

assert.equal(
    sanitizeRichText('<p dir="auto"><strong>Arabic</strong> and English</p><ul><li>One</li><li><em>Two</em></li></ul>'),
    '<p dir="auto"><strong>Arabic</strong> and English</p><ul><li>One</li><li><em>Two</em></li></ul>'
);
assert.equal(sanitizeRichText('First line\nSecond line'), 'First line<br>Second line');
assert.equal(
    sanitizeRichText('<p onclick="alert(1)" style="color:red;text-align:center" dir="auto">Safe &amp; sound</p>'),
    '<p dir="auto" style="text-align:center">Safe &amp; sound</p>'
);
assert.equal(sanitizeRichText('<script>alert(1)</script><img src=x onerror=alert(1)>Safe'), 'Safe');
assert.equal(sanitizeRichText('<p><strong>Unclosed'), '<p><strong>Unclosed</strong></p>');
assert.equal(sanitizeRichText(''), '');

const editorJs = read('public/js/acadme-rich-text-editor.js');
assert.doesNotThrow(() => new vm.Script(editorJs, { filename: 'acadme-rich-text-editor.js' }));
for (const command of ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight']) {
    assert.ok(editorJs.includes(command), 'Missing editor command: ' + command);
}
assert.match(editorJs, /cleanNode/);
assert.match(editorJs, /applyDirection/);
const css = read('public/css/acadme-rich-text-editor.css');
assert.match(css, /@media\(max-width:600px\)/);
assert.match(css, /:dir\(rtl\)/);
const partial = read('views/partials/rich_text_editor.ejs');
assert.match(partial, /contenteditable="true"/);
assert.match(partial, /data-rich-value/);
for (const file of ['views/announcements/form.ejs', 'views/staff/board.ejs', 'views/partials/rich_text_editor.ejs',
    'views/announcements/view.ejs', 'views/portal/announcement.ejs', 'views/portal/assignment.ejs']) {
    ejs.compile(read(file), { filename: path.join(__dirname, '..', file) });
}
assert.match(read('views/announcements/form.ejs'), /rich_text_editor/);
assert.match(read('views/staff/board.ejs'), /rich_text_editor/);
for (const file of ['views/announcements/view.ejs', 'views/portal/announcement.ejs', 'views/portal/assignment.ejs', 'views/staff/board.ejs']) {
    assert.match(read(file), /renderRichText\(/, 'Formatted output missing in ' + file);
}
assert.match(read('controllers/announcementController.js'), /sanitizeRichText\(content\)/);
assert.match(read('controllers/staffController.js'), /sanitizeRichText\(content\)/);
assert.match(read('app.js'), /app\.locals\.renderRichText/);
console.log('AcadMe rich-text editor and sanitisation checks passed.');
