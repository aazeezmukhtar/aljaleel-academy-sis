'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const header=read('views/partials/header.ejs');
assert.ok(header.indexOf('acadme-student-lifecycle.css')>header.indexOf('acadme-components.css'),'Lifecycle stylesheet must load after shared foundation');
const css=read('public/css/acadme-student-lifecycle.css');
const tokens=new Set([...read('public/css/acadme-tokens.css').matchAll(/(--acm-[\w-]+)\s*:/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\((--acm-[\w-]+)/g))assert.ok(tokens.has(m[1]),'Undefined AcadMe token: '+m[1]);
assert.match(css,/@media\(max-width:640px\)/);
assert.match(css,/prefers-reduced-motion:reduce/);
for(const [file,scope] of [['views/students/departure.ejs','student-departure-page'],['views/students/transfer.ejs','student-transfer-page']]){
 const source=read(file);assert.ok(source.includes(scope),'Missing page scope '+scope);assert.doesNotThrow(()=>ejs.compile(source,{filename:path.join(__dirname,'..',file)}));
}
const departure=read('views/students/departure.ejs');
for(const field of ['departureScope','departureType','destinationSchool','departureDate','departureReason','studentDepartureForm','departure_type:kind','departure_scope:scopeVal','effective_date:','reason:'])assert.ok(departure.includes(field),'Departure workflow contract missing '+field);
assert.match(departure,/placements\.length > 1/);
assert.match(departure,/Historical academic and financial records will not be deleted/);
const transfer=read('views/students/transfer.ejs');
for(const field of ['transferSource','transferDestination','transferDate','transferReason','studentTransferForm','source_class_id:','source_session:','destination_class_id:','effective_date:','reason:'])assert.ok(transfer.includes(field),'Transfer workflow contract missing '+field);
assert.match(transfer,/item\.section_id\) === String\(sourceOption\.dataset\.sectionId/);
assert.match(transfer,/Previous academic and financial records will remain unchanged/);
console.log('AcadMe Student Lifecycle UI presentation checks passed.');
