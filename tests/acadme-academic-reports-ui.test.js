'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const header=read('views/partials/header.ejs');
assert.ok(header.indexOf('acadme-academic-reports.css')>header.indexOf('acadme-staff-reports.css'),'Academic reports stylesheet must load after Staff Reports styles');
const css=read('public/css/acadme-academic-reports.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\((--acm-[\w-]+)/g))assert.ok(tokens.has(m[1]),'Undefined token '+m[1]);
for(const [file,scope] of [
 ['views/reports/academic/index.ejs','academic-reports-index-page'],
 ['views/reports/academic/analysis.ejs','academic-analysis-report-page'],
 ['views/reports/academic/top.ejs','academic-top-report-page'],
 ['views/reports/academic/broadsheet.ejs','academic-broadsheet-report-page']
]){const s=read(file);assert.ok(s.includes(scope),'Missing page scope '+scope);assert.ok(!/<style[\s>]/i.test(s),'Inline style block remains in '+file);ejs.compile(s,{filename:path.join(__dirname,'..',file)});}
const index=read('views/reports/academic/index.ejs');
for(const v of ['stats.total_results','stats.subjects','stats.classes','/reports/academic/broadsheet','/reports/academic/analysis','/reports/academic/top','/results/bulk'])assert.ok(index.includes(v),'Academic overview content missing '+v);
const analysis=read('views/reports/academic/analysis.ejs');
for(const v of ['/reports/academic/analysis','name="class_id"','name="term"','name="session"','subject_analysis.csv','window.print()','analysis.forEach','record.students_count','record.eligible_students_count','record.average_score','record.pass_count'])assert.ok(analysis.includes(v),'Subject analysis behavior missing '+v);
const top=read('views/reports/academic/top.ejs');
for(const v of ['/reports/academic/top','name="class_id"','name="term"','name="session"','name="limit"','top_performers.csv','window.print()','topStudents.forEach','student.average_score','student.admission_number'])assert.ok(top.includes(v),'Top performers behavior missing '+v);
const broad=read('views/reports/academic/broadsheet.ejs');
for(const v of ['/reports/academic/broadsheet','name="class_id"','name="term"','name="session"','broadsheet.csv','window.print()','reportData.students.forEach','subjects.forEach','student.results[sub.id]','student.total_score','student.average','A4 landscape'])assert.ok(broad.includes(v),'Broadsheet behavior missing '+v);
for(const v of ['@page{size:A4 landscape;margin:10mm}','@page{size:A4 landscape;margin:5mm}','.academic-broadsheet-report-page .broadsheet-table','print-color-adjust:exact'])assert.ok(css.includes(v),'Print behavior missing '+v);
assert.ok(css.includes('@media(max-width:760px)'),'Mobile layout rules missing');
console.log('AcadMe Academic Reports UI presentation checks passed.');
