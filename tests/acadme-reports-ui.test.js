'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const header = read('views/partials/header.ejs');
const layers = ['acadme-tokens.css','acadme-components.css','acadme-shells.css','acadme-students.css','acadme-attendance.css','acadme-results.css','acadme-finance.css','acadme-academics.css','acadme-staff.css','acadme-reports.css'].map(file => header.indexOf(file));
assert.ok(layers.every((value,index)=>value>=0&&(index===0||value>layers[index-1])), 'Reports styles must load after shared and prior feature layers');
assert.doesNotMatch(header,/\\n\\s*<link[^>]*acadme-reports/);

const css=read('public/css/acadme-reports.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\\w-]+)\\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\\((--acm-[\\w-]+)/g)) assert.ok(tokens.has(m[1]), 'Undefined AcadMe token: '+m[1]);
assert.match(css,/@media\\(max-width:760px\\)/);
assert.match(css,/@media\\(max-width:420px\\)/);
assert.match(css,/@media\\(prefers-reduced-motion:reduce\\)/);

const pages = [
 ['views/reports/index.ejs','reports-center-page'],
 ['views/reports/academic/index.ejs','reports-academic-page'],
 ['views/reports/attendance/index.ejs','reports-attendance-page'],
 ['views/reports/finance/index.ejs','reports-finance-page'],
 ['views/reports/staff/index.ejs','reports-staff-page'],
 ['views/reports/student/index.ejs','reports-student-page'],
 ['views/reports/health/index.ejs','reports-health-page'],
 ['views/reports/audit.ejs','reports-audit-page']
];
for(const [file,scope] of pages){
 const source=read(file);
 assert.ok(source.includes(scope),'Missing report page scope '+scope);
 ejs.compile(source,{filename:path.join(__dirname,'..',file)});
}
const center=read('views/reports/index.ejs');
for(const route of ['/reports/academic','/reports/students','/reports/attendance','/reports/fees','/reports/staff','/reports/health','/reports/audit']) assert.ok(center.includes(route),'Missing existing report destination '+route);
assert.match(center,/user\.role==='Admin' \|\| user\.role==='Bursar'/);
assert.match(center,/user\.role==='Admin'/);
const audit=read('views/reports/audit.ejs');
for(const field of ['Timestamp','User','Module','Action','Details','IP Address']) assert.ok(audit.includes(field),'Missing audit table field '+field);
console.log('AcadMe Reports UI presentation checks passed.');
