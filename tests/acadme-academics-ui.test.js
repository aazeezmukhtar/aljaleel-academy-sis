'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const header = read('views/partials/header.ejs');
const layers = ['acadme-tokens.css','acadme-components.css','acadme-shells.css','acadme-students.css','acadme-attendance.css','acadme-results.css','acadme-finance.css','acadme-academics.css'].map(file => header.indexOf(file));
assert.ok(layers.every((value,index)=>value>=0&&(index===0||value>layers[index-1])), 'Academics styles must load after shared and prior feature layers');
assert.doesNotMatch(header,/\n\s*<link[^>]*acadme-academics/);

const css=read('public/css/acadme-academics.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\((--acm-[\w-]+)/g)) assert.ok(tokens.has(m[1]), 'Undefined AcadMe token: '+m[1]);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);

const index=read('views/academics/index.ejs');
assert.match(index,/class="main-content academics-page"/);
for(const action of ['/academics/classes/add','/academics/classes/update/','/academics/classes/delete/','/academics/subjects/add','/academics/subjects/delete/','/academics/assignments/add','/academics/assignments/delete/']) assert.ok(index.includes(action),'Missing existing academic action '+action);
for(const field of ['name="section_id"','name="teacher_id"','name="subject_id"','name="class_id"','name="session"','id="academic-assignment-session"']) assert.ok(index.includes(field),'Missing existing academic field '+field);
assert.match(index,/selected_session === 'current'/);
assert.match(index,/selected_session === 'all'/);
assert.match(index,/function toggleAcademicForm/);
assert.match(index,/function openEditClassModal/);
assert.match(index,/function closeEditClassModal/);
ejs.compile(index,{filename:path.join(__dirname,'..','views/academics/index.ejs')});

const edit=read('views/academics/edit-subject.ejs');
assert.match(edit,/class="main-content academics-edit-subject-page"/);
assert.match(edit,/action="\/academics\/subjects\/update\//);
assert.match(edit,/name="name"/);
assert.match(edit,/name="code"/);
ejs.compile(edit,{filename:path.join(__dirname,'..','views/academics/edit-subject.ejs')});
console.log('AcadMe Academics UI presentation checks passed.');
