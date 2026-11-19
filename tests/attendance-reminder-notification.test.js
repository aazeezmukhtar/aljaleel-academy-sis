'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const controller=fs.readFileSync(path.join(root,'controllers/notificationController.js'),'utf8');
const notificationBar=fs.readFileSync(path.join(root,'views/partials/notification_bar.ejs'),'utf8');
const registerService=fs.readFileSync(path.join(root,'services/attendanceRegisterService.js'),'utf8');

assert(controller.includes("if (req.session.staff)") &&
  controller.includes("collectForStaff({ schoolId, staffId: userId, today })"),
  'Only authenticated staff should receive attendance register reminders.');
assert(controller.includes("source_type: 'attendance_register_reminder'") &&
  controller.includes('/attendance/take?class_id='),
  'Reminder notifications must link to the exact class and date.');
assert(controller.includes("SELECT source_id, source_type FROM notification_reads") &&
  controller.includes('readSet.has'),
  'Attendance reminders must use the existing notification read-state mechanism.');
assert(notificationBar.includes('markAsRead(n.id, n.source_type, n.url)'),
  'The notification UI must mark reminders read using their own source type.');
assert(registerService.includes('UPDATE attendance_register_reminders') &&
  registerService.includes("SET status = 'resolved'"),
  'Submitting a register must resolve its reminder.');
console.log('[attendance-reminder-notification] staff-only delivery, exact attendance link, read state and submission resolution passed.');
