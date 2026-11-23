'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const header=read('views/partials/header.ejs');
assert.ok(header.indexOf('acadme-staff-reports.css')>header.indexOf('acadme-health-reports.css'),'Staff reports stylesheet must load after Health Reports styles');
const css=read('public/css/acadme-staff-reports.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\((--acm-[\w-]+)/g))assert.ok(tokens.has(m[1]),'Undefined token '+m[1]);
for(const [file,scope] of [
 ['views/reports/staff/index.ejs','staff-reports-index-page'],
 ['views/reports/staff/directory.ejs','staff-directory-report-page'],
 ['views/reports/staff/activity.ejs','staff-activity-report-page'],
 ['views/reports/staff/workload.ejs','staff-workload-report-page']
]){const s=read(file);assert.ok(s.includes(scope),'Missing page scope '+scope);assert.ok(!/<style[\s>]/i.test(s),'Inline style block remains in '+file);ejs.compile(s,{filename:path.join(__dirname,'..',file)});}
const index=read('views/reports/staff/index.ejs');
for(const v of ['stats.total_staff','stats.teaching_staff','stats.admins','/reports/staff/directory','/reports/staff/workload','/reports/staff/activity'])assert.ok(index.includes(v),'Staff overview content missing '+v);
const directory=read('views/reports/staff/directory.ejs');
for(const v of ['/reports/staff/directory','name="role"','Admin','Teacher','Bursar','staff_directory.csv','window.print()','staffList.forEach','staff.staff_id','staff.email','staff.phone'])assert.ok(directory.includes(v),'Staff directory behavior missing '+v);
const activity=read('views/reports/staff/activity.ejs');
for(const v of ['/reports/staff/activity','name="staff_id"','activity_log.csv','.data-table','allStaff.forEach','logs.forEach','log.timestamp','log.module','log.action','log.details','log.ip_address'])assert.ok(activity.includes(v),'Activity report behavior missing '+v);
const workload=read('views/reports/staff/workload.ejs');
for(const v of ['staff_workload.csv','window.print()','staffWorkload.forEach','staff.classes','staff.subjects','staff.class_count','staff.subject_count','section-specific sessions are respected'])assert.ok(workload.includes(v),'Workload report behavior missing '+v);
for(const v of ['@page{size:A4;margin:10mm}','body *{visibility:hidden}','.staff-report-detail-page .report-paper,.staff-report-detail-page .report-paper *{visibility:visible}','.staff-report-detail-page .no-print{display:none!important}'])assert.ok(css.includes(v),'Print behavior missing '+v);
assert.ok(css.includes('@media(max-width:760px)'),'Mobile layout rules missing');
console.log('AcadMe Staff Reports UI presentation checks passed.');
