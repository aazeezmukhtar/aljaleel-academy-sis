'use strict';
const db = require('../utils/db');
const clean = (v, n=500) => v == null || String(v).trim()==='' ? null : String(v).trim().slice(0,n);
const date = v => {
 if (!v) return null;
 const value = String(v).trim();
 const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if (!match) return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const parsed=new Date(Date.UTC(year,month-1,day));
 return parsed.getUTCFullYear()===year && parsed.getUTCMonth()===month-1 && parsed.getUTCDate()===day ? value : null;
};
const dateInputValue = value => {
 if (!value) return '';
 if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0,10);
 const text=String(value).trim();
 const match=text.match(/^(\d{4}-\d{2}-\d{2})/);
 return match && date(match[1]) ? match[1] : '';
};
const sid = req => Number(req.schoolId || req.session.staff.school_id || 1);
const me = req => Number(req.session.staff.id);

async function render(req,res,id,own) {
 const school=sid(req);
 const member=await db.get('SELECT id,school_id,first_name,last_name,staff_id,role,designation,status,avatar_image FROM staff WHERE id=? AND school_id=?',[id,school]);
 if(!member) return res.status(404).send('Staff member not found');
 let personal=null,employment=null,contacts=[],qualifications=[],migrationRequired=false;
 try {
  personal=await db.get('SELECT * FROM staff_personal_details WHERE staff_id=? AND school_id=?',[id,school]);
  if (personal) personal.date_of_birth_input=dateInputValue(personal.date_of_birth);
  employment=await db.get('SELECT * FROM staff_employment_details WHERE staff_id=? AND school_id=?',[id,school]);
  if (employment) {
   employment.employment_start_date_input=dateInputValue(employment.employment_start_date);
   employment.employment_end_date_input=dateInputValue(employment.employment_end_date);
  }
  contacts=await db.all('SELECT * FROM staff_emergency_contacts WHERE staff_id=? AND school_id=? ORDER BY is_primary DESC,id',[id,school]);
  qualifications=await db.all('SELECT q.*,v.first_name AS verifier_first_name,v.last_name AS verifier_last_name FROM staff_qualifications q LEFT JOIN staff v ON v.id=q.verified_by AND v.school_id=q.school_id WHERE q.staff_id=? AND q.school_id=? ORDER BY q.award_year DESC,q.id DESC',[id,school]);
 } catch(e) {
  if(/staff_(personal_details|employment_details|emergency_contacts|qualifications)/i.test(e.message||'')) migrationRequired=true;
  else throw e;
 }
 return res.render('staff/information',{title:own?'My Profile':'Staff Information',member,personal,employment,contacts,qualifications,isOwnProfile:own,isAdmin:req.session.staff.role==='Admin',migrationRequired,error:req.query.error||null,success:req.query.success||null});
}
exports.getMyProfile=async(req,res)=>{try{return await render(req,res,me(req),true)}catch(e){console.error('getMyProfile',e);return res.status(500).send('Unable to load profile')}};
exports.getStaffInformation=async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).send('Invalid staff ID');try{return await render(req,res,id,false)}catch(e){console.error('getStaffInformation',e);return res.status(500).send('Unable to load staff information')}};

exports.savePersonalDetails=async(req,res)=>{
 const b=req.body||{},rawDob=typeof b.date_of_birth==='string'?b.date_of_birth.trim():'',d=date(rawDob),clearDob=b.clear_date_of_birth==='1';
 if(rawDob&&!d)return res.redirect('/staff/my-profile?error=Enter a valid date of birth');
 try{
  await db.run('INSERT INTO staff_personal_details (school_id,staff_id,date_of_birth,gender,phone,alternate_phone,personal_email,residential_address,nationality,marital_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT (staff_id) DO UPDATE SET date_of_birth=CASE WHEN ? THEN NULL WHEN excluded.date_of_birth IS NOT NULL THEN excluded.date_of_birth ELSE staff_personal_details.date_of_birth END,gender=excluded.gender,phone=excluded.phone,alternate_phone=excluded.alternate_phone,personal_email=excluded.personal_email,residential_address=excluded.residential_address,nationality=excluded.nationality,marital_status=excluded.marital_status,updated_at=CURRENT_TIMESTAMP',
  [sid(req),me(req),d,clean(b.gender,40),clean(b.phone,40),clean(b.alternate_phone,40),clean(b.personal_email,160),clean(b.residential_address,1000),clean(b.nationality,80),clean(b.marital_status,40),clearDob]);
  res.redirect('/staff/my-profile?success=Personal details saved');
 }catch(e){console.error('savePersonalDetails',e);res.redirect('/staff/my-profile?error=Could not save. The staff information migration may not be installed.')}
};
exports.addEmergencyContact=async(req,res)=>{
 const b=req.body||{},name=clean(b.contact_name,120),phone=clean(b.phone,40);
 if(!name||!phone)return res.redirect('/staff/my-profile?error=Contact name and phone are required');
 try{
  await db.transaction(async client=>{
   if(b.is_primary==='1')await db.run('UPDATE staff_emergency_contacts SET is_primary=FALSE,updated_at=CURRENT_TIMESTAMP WHERE staff_id=? AND school_id=?',[me(req),sid(req)],client);
   await db.run('INSERT INTO staff_emergency_contacts (school_id,staff_id,contact_name,relationship,phone,alternate_phone,email,address,is_primary) VALUES (?,?,?,?,?,?,?,?,?)',[sid(req),me(req),name,clean(b.relationship,60),phone,clean(b.alternate_phone,40),clean(b.email,160),clean(b.address,500),b.is_primary==='1'],client);
  });
  res.redirect('/staff/my-profile?success=Emergency contact added');
 }catch(e){console.error('addEmergencyContact',e);res.redirect('/staff/my-profile?error=Could not add contact. The staff information migration may not be installed.')}
};
exports.deleteEmergencyContact=async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).send('Invalid contact ID');
 try{await db.run('DELETE FROM staff_emergency_contacts WHERE id=? AND staff_id=? AND school_id=?',[id,me(req),sid(req)]);res.redirect('/staff/my-profile?success=Emergency contact removed')}
 catch(e){console.error('deleteEmergencyContact',e);res.redirect('/staff/my-profile?error=Could not remove contact')}
};
exports.addQualification=async(req,res)=>{
 const b=req.body||{},q=clean(b.qualification,160),year=b.award_year?Number(b.award_year):null;
 if(!q||(year!==null&&(!Number.isInteger(year)||year<1900||year>new Date().getFullYear()+5)))return res.redirect('/staff/my-profile?error=Enter a qualification and valid award year');
 try{await db.run("INSERT INTO staff_qualifications (school_id,staff_id,qualification,field_of_study,institution,award_year,certificate_reference,verification_status) VALUES (?,?,?,?,?,?,?,'pending')",[sid(req),me(req),q,clean(b.field_of_study,160),clean(b.institution,200),year,clean(b.certificate_reference,120)]);res.redirect('/staff/my-profile?success=Qualification submitted for review')}
 catch(e){console.error('addQualification',e);res.redirect('/staff/my-profile?error=Could not submit qualification. The staff information migration may not be installed.')}
};
exports.saveEmploymentDetails=async(req,res)=>{
 const id=Number(req.params.id),b=req.body||{},start=date(b.employment_start_date),end=date(b.employment_end_date);
 if(!Number.isInteger(id)||id<1)return res.status(400).send('Invalid staff ID');
 if((b.employment_start_date&&!start)||(b.employment_end_date&&!end)||(start&&end&&end<start))return res.redirect('/staff/information/'+id+'?error=Check the employment dates');
 try{
  const member=await db.get('SELECT id FROM staff WHERE id=? AND school_id=?',[id,sid(req)]);if(!member)return res.status(404).send('Staff member not found');
  await db.run('INSERT INTO staff_employment_details (school_id,staff_id,department,employment_type,employment_start_date,employment_end_date,work_email,work_phone,notes,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT (staff_id) DO UPDATE SET department=excluded.department,employment_type=excluded.employment_type,employment_start_date=excluded.employment_start_date,employment_end_date=excluded.employment_end_date,work_email=excluded.work_email,work_phone=excluded.work_phone,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP',[sid(req),id,clean(b.department,120),clean(b.employment_type,80),start,end,clean(b.work_email,160),clean(b.work_phone,40),clean(b.notes,1000)]);
  res.redirect('/staff/information/'+id+'?success=Employment details saved');
 }catch(e){console.error('saveEmploymentDetails',e);res.redirect('/staff/information/'+id+'?error=Could not save employment details')}
};
exports.verifyQualification=async(req,res)=>{
 const id=Number(req.params.id),status=req.body&&req.body.verification_status;
 if(!Number.isInteger(id)||id<1||!['verified','rejected','pending'].includes(status))return res.status(400).send('Invalid qualification review');
 try{const result=await db.run("UPDATE staff_qualifications SET verification_status=?,verified_by=?,verified_at=CASE WHEN ?='pending' THEN NULL ELSE CURRENT_TIMESTAMP END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?",[status,status==='pending'?null:me(req),status,id,sid(req)]);if(!result.changes)return res.status(404).send('Qualification not found');res.redirect(req.get('referer')||'/staff')}
 catch(e){console.error('verifyQualification',e);res.status(500).send('Could not update qualification review')}
};

exports.updateOwnAvatar=async(req,res)=>{
 if(!req.file)return res.redirect('/staff/my-profile?error=Choose an image first');
 if(!/^image\/(jpeg|png|webp|gif)$/.test(req.file.mimetype||''))return res.redirect('/staff/my-profile?error=Use a JPG, PNG, WEBP or GIF image');
 try{
  const {uploadFile}=require('../utils/storageHelper');
  const url=await uploadFile(req.file,'staff');
  if(!url)return res.redirect('/staff/my-profile?error=Image upload failed');
  await db.run('UPDATE staff SET avatar_image=? WHERE id=? AND school_id=?',[url,me(req),sid(req)]);
  req.session.staff.avatar_image=url;
  res.redirect('/staff/my-profile?success=Profile photo updated');
 }catch(e){console.error('updateOwnAvatar',e);res.redirect('/staff/my-profile?error=Could not update profile photo')}
};
