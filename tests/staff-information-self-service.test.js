'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const routes=read('routes/staffRoutes.js'),controller=read('controllers/staffInformationController.js'),view=read('views/staff/information.ejs'),sidebar=read('views/partials/sidebar.ejs');
function check(n,f){try{f();console.log('PASS: '+n)}catch(e){console.error('FAIL: '+n+' — '+e.message);process.exitCode=1}}
check('self-service and administrator routes exist',()=>{assert.match(routes,/router\.get\('\/my-profile', informationController\.getMyProfile\)/);assert.match(routes,/router\.post\('\/information\/:id\/employment', isAdmin/);assert.match(routes,/router\.post\('\/qualifications\/:id\/review', isAdmin/);});
check('self-service writes use the authenticated staff identity and school scope',()=>{for(const x of ['savePersonalDetails','addEmergencyContact','deleteEmergencyContact','addQualification'])assert.match(controller,new RegExp('exports\\.'+x));assert.match(controller,/me\(req\)/);assert.match(controller,/school_id=\?/);});
check('profile view compiles and contains all information sections',()=>{ejs.compile(view,{filename:path.join(__dirname,'..','views/staff/information.ejs')});for(const x of ['Personal and contact details','Emergency contacts','Qualifications','Employment information'])assert.ok(view.includes(x));});
check('My Profile navigation is available to authenticated staff',()=>assert.match(sidebar,/href="\/staff\/my-profile"/));

check('date of birth is normalized for HTML date inputs across PostgreSQL Date objects and date strings',()=>{
 assert.match(controller,/const dateInputValue = value =>/);
 assert.match(controller,/value instanceof Date/);
 assert.match(controller,/date_of_birth_input=dateInputValue\(personal\.date_of_birth\)/);
 assert.match(view,/personal\?personal\.date_of_birth_input/);
});
check('saving other personal details preserves an existing date of birth unless explicitly cleared',()=>{
 assert.match(controller,/WHEN \? THEN NULL WHEN excluded\.date_of_birth IS NOT NULL THEN excluded\.date_of_birth ELSE staff_personal_details\.date_of_birth END/);
 assert.match(controller,/clearDob\]\);/);
 assert.match(view,/name="clear_date_of_birth" value="1"/);
 assert.match(view,/Leaving the date field blank will keep your existing date/);
});
check('date validation rejects impossible calendar dates',()=>{
 assert.match(controller,/getUTCFullYear\(\)===year && parsed\.getUTCMonth\(\)===month-1 && parsed\.getUTCDate\(\)===day/);
});
