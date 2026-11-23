'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const header=read('views/partials/header.ejs');assert.ok(header.indexOf('acadme-student-reports.css')>header.indexOf('acadme-reports.css'));
const css=read('public/css/acadme-student-reports.css'),tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\((--acm-[\w-]+)/g))assert.ok(tokens.has(m[1]),'Undefined token '+m[1]);
for(const [file,scope] of [['views/reports/student/index.ejs','student-reports-index-page'],['views/reports/student/list.ejs','student-class-list-page'],['views/reports/student/demographics.ejs','student-demographics-page'],['views/reports/student/audit.ejs','student-profile-audit-page']]){const s=read(file);assert.ok(s.includes(scope));ejs.compile(s,{filename:path.join(__dirname,'..',file)});}
const list=read('views/reports/student/list.ejs');for(const v of ['/reports/students/list','name="class_id"','class_list.csv','window.print()','student.guardian_phone || student.parent_phone','@media print','size: A4'])assert.ok(list.includes(v),'Class-list behavior/print rule missing '+v);
const demo=read('views/reports/student/demographics.ejs');for(const v of ['data-filename="age_distribution.csv"','data-target=".data-table"','window.print()','d.percentage','a.age_range'])assert.ok(demo.includes(v),'Demographics behavior missing '+v);
const audit=read('views/reports/student/audit.ejs');for(const v of ['/students/edit/<%= s.id %>','s.missing_photo','s.missing_phone','s.missing_dob','s.missing_address','profile_audit.csv'])assert.ok(audit.includes(v),'Audit behavior missing '+v);
assert.match(list,/<style>[\s\S]*?@media print[\s\S]*?<\/style>/);
console.log('AcadMe Student Reports UI presentation checks passed.');
