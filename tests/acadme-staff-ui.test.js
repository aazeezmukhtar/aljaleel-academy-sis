'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const header = read('views/partials/header.ejs');
const layers = ['acadme-tokens.css','acadme-components.css','acadme-shells.css','acadme-students.css','acadme-attendance.css','acadme-results.css','acadme-finance.css','acadme-academics.css','acadme-staff.css'].map(file => header.indexOf(file));
assert.ok(layers.every((value,index)=>value>=0&&(index===0||value>layers[index-1])), 'Staff styles must load after shared and feature layers');
assert.doesNotMatch(header,/\n\s*<link[^>]*acadme-staff/);

const css=read('public/css/acadme-staff.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\((--acm-[\w-]+)/g)) assert.ok(tokens.has(m[1]), 'Undefined AcadMe token: '+m[1]);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);

const resultEntry = read('views/results/manager.ejs');
const resultCss = read('public/css/acadme-results.css');
const staffCss = read('public/css/acadme-staff.css');
assert.match(resultEntry, /result-context-eyebrow">Editing Results For/);
assert.match(resultEntry, /result-context-title/);
assert.match(resultEntry, /Offline Use/);
assert.doesNotMatch(resultEntry, /Prepare for Offline Use/);
assert.match(resultEntry, /result-context-buttons/);
assert.match(resultEntry, /result-context-period[\\s\\S]*filters\\.term[\\s\\S]*filters\\.session/);
assert.ok(resultEntry.indexOf('result-context-period') > resultEntry.indexOf('result-context-toolbar'),'Term/session must be row three, after the toolbar');
ejs.compile(resultEntry,{filename:path.join(__dirname,'..','views/results/manager.ejs')});
assert.match(resultEntry, /filters\.term/);
assert.match(resultEntry, /filters\.session/);
assert.match(resultEntry, /data-score-count=.*resultConfig\\.ca_count/);
assert.match(resultCss, /grid-template-columns:minmax\\(0,1fr\\) 46px 46px 34px 32px!important/);
assert.match(resultCss, /grid-template-columns:minmax\\(0,1fr\\) repeat\\(3,42px\\)!important/);
assert.match(resultCss, /row-info>div:first-child\\{display:flex!important;width:36px!important;height:42px!important/);
assert.match(resultCss, /min-height:34px;height:34px/);
assert.match(resultCss, /result-sheet-card\\{width:100%;max-width:100%;min-width:0;margin-inline:0;padding:0!important/);
assert.match(staffCss, /staff-directory-page \.table-container\.table-stack tbody tr\{width:100%/);

const pages = [
 ['views/staff/index.ejs','staff-directory-page',['/staff/add','/staff/view/','staff-directory-search','staff-role-filter','staff-status-filter']],
 ['views/staff/add.ejs','staff-create-page',['action="/staff/add"','name="first_name"','name="last_name"','name="staff_id"','name="role"','name="designation"','name="avatar_image"','name="public_bio"','name="show_on_website"']],
 ['views/staff/edit.ejs','staff-edit-page',['/staff/update/','name="first_name"','name="last_name"','name="staff_id"','name="role"','name="status"','name="avatar_image"','name="public_bio"','name="show_on_website"']],
 ['views/staff/view.ejs','staff-profile-page',['/staff/information/','/staff/edit/','/staff/delete/','name="session"','openSubjectAssignmentModal','openClassAssignmentModal']],
 ['views/staff/information.ejs','staff-information-page',['/staff/my-profile/personal','/staff/my-profile/photo','/staff/my-profile/emergency-contacts','/staff/my-profile/qualifications','/staff/information/']]
];
for(const [file,scope,required] of pages){
 const source=read(file);
 assert.ok(source.includes(scope),'Missing page scope '+scope+' in '+file);
 for(const item of required) assert.ok(source.includes(item),'Missing existing staff feature '+item+' in '+file);
 ejs.compile(source,{filename:path.join(__dirname,'..',file)});
}
console.log('AcadMe Staff Management UI presentation checks passed.');

assert.match(resultCss, /flex-direction:column;align-items:stretch;gap:5px/);
assert.match(resultCss, /justify-self:end!important;width:100%/);
