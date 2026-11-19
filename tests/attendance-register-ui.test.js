'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '..', 'views', 'attendance', 'take.ejs');
const template = fs.readFileSync(templatePath, 'utf8');
ejs.compile(template, { filename: templatePath });
if (!template.includes("student.status || 'Not recorded'") ||
    !template.includes("currentStatus === 'Not recorded' ? '' : currentStatus") ||
    !template.includes("STATUS_CYCLE = ['Present', 'Absent', 'Leave', 'Late', 'Not recorded']")) {
  throw new Error('Unmarked students must remain explicitly unrecorded until a staff member selects a status.');
}
if (template.includes("input.value = 'Absent'") || !template.includes('unknownEnrollmentCount || 0')) {
  throw new Error('The attendance page must not silently mark unrecorded students absent and must surface enrollment-date gaps.');
}
const responsibilityPath = path.join(__dirname, '..', 'views', 'attendance', 'responsibilities.ejs');
ejs.compile(fs.readFileSync(responsibilityPath, 'utf8'), { filename: responsibilityPath });
console.log('[attendance-register-ui] attendance page and responsibility management EJS templates compiled successfully.');
