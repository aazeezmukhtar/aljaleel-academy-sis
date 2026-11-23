'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const header=read('views/partials/header.ejs');
assert.ok(header.indexOf('acadme-finance-reports.css')>header.indexOf('acadme-academic-reports.css'),'Finance reports stylesheet must load after Academic Reports styles');
const css=read('public/css/acadme-finance-reports.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\\((--acm-[\w-]+)/g))assert.ok(tokens.has(m[1]),'Undefined token '+m[1]);
for(const [file,scope] of [
 ['views/reports/finance/index.ejs','finance-reports-index-page'],
 ['views/reports/finance/debtors.ejs','finance-debtors-report-page'],
 ['views/reports/finance/status.ejs','finance-status-report-page']
]){const s=read(file);assert.ok(s.includes(scope),'Missing page scope '+scope);assert.ok(!/<style[\s>]/i.test(s),'Inline style block remains in '+file);ejs.compile(s,{filename:path.join(__dirname,'..',file)});}
const overview=read('views/reports/finance/index.ejs');
for(const v of ['stats.total_collected_session','stats.total_payment_today','/reports/finance/status','/reports/finance/debtors','/fees/manager'])assert.ok(overview.includes(v),'Finance overview content missing '+v);
const debt=read('views/reports/finance/debtors.ejs');
for(const v of ['/reports/finance/debtors','name="min_debt"','query.min_debt','debtors.forEach','student.payable','student.paid','student.debt','debtors_list.csv','window.print()'])assert.ok(debt.includes(v),'Debtors behavior missing '+v);
const status=read('views/reports/finance/status.ejs');
for(const v of ['/reports/finance/status','name="class_id"','name="status"','query.class_id','query.status','students.forEach','student.total_payable','student.paid_amount','student.balance','student.status','fee_status.csv','window.print()'])assert.ok(status.includes(v),'Fee status behavior missing '+v);
for(const v of ['@page{size:A4;margin:10mm}','.status-badge.paid','.status-badge.partial','.status-badge.unpaid','@media(max-width:760px)'])assert.ok(css.includes(v),'Responsive or print styling missing '+v);
console.log('AcadMe Finance Reports UI presentation checks passed.');
