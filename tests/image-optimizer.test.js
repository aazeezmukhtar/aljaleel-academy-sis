'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const optimizer = fs.readFileSync(path.join(root, 'public/js/image-optimizer.js'), 'utf8');
const adminStaffShell = fs.readFileSync(path.join(root, 'views/partials/header.ejs'), 'utf8');
const studentShell = fs.readFileSync(path.join(root, 'views/partials/student_shell_head.ejs'), 'utf8');

assert(optimizer.includes("new Set(['image/jpeg', 'image/png', 'image/webp'])"),
  'Only supported static photo formats should be transformed');
assert(optimizer.includes('MAX_DIMENSION = 1600'), 'Photos should be capped at 1600px');
assert(optimizer.includes('JPEG_QUALITY = 0.82'), 'JPEG quality should use the configured target');
assert(optimizer.includes("file.type === 'image/png' ? 'image/png' : 'image/jpeg'"),
  'PNG transparency must be retained');
assert(optimizer.includes('if (!blob || blob.size >= file.size) return file'),
  'An optimized image must never replace a smaller original with a larger file');
assert(optimizer.includes('return file;'), 'Failures must preserve the original file');
assert(adminStaffShell.includes('/js/image-optimizer.js'),
  'Admin and staff shell must load the shared optimizer');
assert(studentShell.includes('/js/image-optimizer.js'),
  'Student portal shell must load the shared optimizer');


assert(optimizer.includes('function cropImage(file)'), 'The shared crop editor should be available');
assert(optimizer.includes("input.dataset.crop === 'square'"), 'Square crop should run before optimization');
assert(optimizer.includes('CROP_OUTPUT_SIZE = 1200'), 'Cropped profile photos should be normalized to 1200px square');
assert(optimizer.includes('Use this photo'), 'The crop editor should require explicit confirmation');
assert(optimizer.includes("input.value = '';"), 'Cancelling crop must cancel the upload');
for (const file of ['views/students/enroll.ejs', 'views/students/edit.ejs', 'views/staff/add.ejs', 'views/portal/profile.ejs']) {
  const view = fs.readFileSync(path.join(root, file), 'utf8');
  assert(view.includes('data-crop="square"'), file + ' should use the square crop editor');
}

console.log('PASS: browser image optimizer policy and portal shell integration checks');
