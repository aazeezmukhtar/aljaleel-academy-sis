const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

router.get('/', attendanceController.getIndex);
router.get('/take', attendanceController.getTakeAttendance);
router.post('/save', attendanceController.saveAttendance);
router.get('/report', attendanceController.getReport);

// Staff Attendance
router.get('/staff', attendanceController.getStaffAttendance);
router.post('/staff/save', attendanceController.saveStaffAttendance);

module.exports = router;
