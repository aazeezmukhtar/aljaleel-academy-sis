'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),ejs=require('ejs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const routes=read('routes/staffRoutes.js'),controller=read('controllers/staffInformationController.js'),view=read('views/staff/information.ejs'),sidebar=read('views/partials/sidebar.ejs');
function check(n,f){try{f();console.log('PASS: '+n)}catch(e){console.error('FAIL: '+n+' — '+e.message);process.exitCode=1}}
check('self-service and administrator routes exist',()=>{assert.match(routes,/router\.get\('\/my-profile', informationController\.getMyProfile\)/);assert.match(routes,/router\.post\('\/information\/:id\/employment', isAdmin/);assert.match(routes,/router\.post\('\/qualifications\/:id\/review', isAdmin/);});
check('self-service writes use the authenticated staff identity and school scope',()=>{for(const x of ['savePersonalDetails','addEmergencyContact','deleteEmergencyContact','addQualification'])assert.match(controller,new RegExp('exports\\.'+x));assert.match(controller,/me\(req\)/);assert.match(controller,/school_id=\?/);});
check('profile view compiles and contains all information sections',()=>{ejs.compile(view,{filename:path.join(__dirname,'..','views/staff/information.ejs')});for(const x of ['Personal and contact details','Emergency contacts','Qualifications','Employment information'])assert.ok(view.includes(x));});
check('My Profile navigation is available to authenticated staff',()=>assert.match(sidebar,/href="\/staff\/my-profile"/));
