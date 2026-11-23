'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const header=read('views/partials/header.ejs');
assert.ok(header.indexOf('acadme-health-reports.css')>header.indexOf('acadme-student-reports.css'),'Health reports stylesheet must load after shared report styles');
const css=read('public/css/acadme-health-reports.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\\w-]+)\\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\\((--acm-[\\w-]+)/g))assert.ok(tokens.has(m[1]),'Undefined token '+m[1]);
for(const [file,scope] of [
 ['views/reports/health/index.ejs','health-reports-index-page'],
 ['views/reports/health/alerts.ejs','health-alerts-page'],
 ['views/reports/health/contacts.ejs','health-contacts-page']
]){const s=read(file);assert.ok(s.includes(scope),'Missing page scope '+scope);assert.ok(!/<style[\\s>]/i.test(s),'Inline style block remains in '+file);}
const index=read('views/reports/health/index.ejs');
for(const v of ['stats.students_with_conditions','stats.students_with_allergies','stats.blood_group_a','/reports/health/alerts','/reports/health/contacts'])assert.ok(index.includes(v),'Health overview content missing '+v);
const alerts=read('views/reports/health/alerts.ejs');
for(const v of ['/reports/health/alerts','name="class_id"','medical_alerts.csv','window.print()','medicalRisks.forEach','student.medical_conditions','student.allergies','student.blood_group','student.emergency_contact_phone','Confidential'])assert.ok(alerts.includes(v),'Medical alert behavior missing '+v);
const contacts=read('views/reports/health/contacts.ejs');
for(const v of ['/reports/health/contacts','name="class_id"','emergency_contacts.csv','window.print()','contacts.forEach','contact.contact_name','contact.contact_phone','contact.blood_group'])assert.ok(contacts.includes(v),'Emergency contact behavior missing '+v);
for(const v of ['@page{size:A4;margin:10mm}','body *{visibility:hidden}','.health-report-detail-page .report-paper,.health-report-detail-page .report-paper *{visibility:visible}','.no-print{display:none!important}'])assert.ok(css.includes(v),'Print behavior missing '+v);
assert.ok(css.includes('@media(max-width:760px)'),'Mobile layout rules missing');
console.log('AcadMe Health Reports UI presentation checks passed.');
