'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const page=read('views/attendance/index.ejs');
const css=read('public/css/acadme-attendance-landing.css');
const header=read('views/partials/header.ejs');
const pkg=JSON.parse(read('package.json'));
ejs.compile(page,{filename:'views/attendance/index.ejs'});
assert.ok(page.includes('attendance-page'));
assert.ok(!/<style|\sstyle="/i.test(page),'Attendance landing template should not contain embedded presentation styles');
assert.ok(header.includes('acadme-attendance-landing.css'));
assert.ok(header.indexOf('acadme-attendance-operations.css') < header.indexOf('acadme-attendance-landing.css'));
assert.equal(pkg.scripts['test:acadme-attendance-landing-ui'],'node tests/acadme-attendance-landing-ui.test.js');
for(const contract of [
 'id="attendance-selection-form"','action="/attendance/take"','name="class_id"','name="date"',
 'viewPreviousAttendance()','attendance-offline-prep-status','data-section-filter="all"',
 'attendanceGroups','termAbsenceLimit','consecutiveAbsenceLimit',
 'buildAttendancePreparationDates','getPreparedDatasetStatus','recordPreparedDataset',
 'X-AcadMe-Offline-Prepare','X-AcadMe-Offline-Cached','attendance:'
]) assert.ok(page.includes(contract),'Missing preserved page contract: '+contract);
for(const cls of ['attendance-risk-filter','attendance-risk-class','attendance-risk-student','attendance-risk-centered-cell']) assert.ok(css.includes('.'+cls));
console.log('AcadMe attendance landing UI source checks passed.');
