const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const mainReportController = require('../controllers/reporting/mainReportController');
const studentReportController = require('../controllers/reporting/studentReportController');
const academicReportController = require('../controllers/reporting/academicReportController');
const attendanceReportController = require('../controllers/reporting/attendanceReportController');
const staffReportController = require('../controllers/reporting/staffReportController');
const financeReportController = require('../controllers/reporting/financeReportController');
const healthReportController = require('../controllers/reporting/healthReportController');
const { isAdmin } = require('../middleware/authMiddleware');

router.get('/', mainReportController.getReportDashboard);

// Student Reports
router.get('/students', studentReportController.getStudentDashboard); // NEW DASHBOARD
router.get('/students/list', studentReportController.getClassListReport);
router.get('/students/demographics', studentReportController.getDemographicsReport);
router.get('/students/audit', studentReportController.getProfileAuditReport);

// Academic Reports
router.get('/academic', academicReportController.getAcademicDashboard); // NEW DASHBOARD
router.get('/academic/broadsheet', academicReportController.getBroadsheet);
router.get('/academic/analysis', academicReportController.getSubjectAnalysis);
router.get('/academic/top', academicReportController.getTopPerformers);

// Attendance Reports
router.get('/attendance', attendanceReportController.getAttendanceDashboard);
router.get('/attendance/register', attendanceReportController.getRegister);
router.get('/attendance/low', attendanceReportController.getLowAttendance);
router.get('/attendance/daily', attendanceReportController.getDailyAttendance);

// Staff Reports
router.get('/staff', staffReportController.getStaffDashboard);
router.get('/staff/directory', staffReportController.getStaffDirectory);
router.get('/staff/workload', staffReportController.getWorkloadReport);
router.get('/staff/activity', staffReportController.getActivityLog);

// Finance Reports
router.get('/finance', financeReportController.getFinanceDashboard);
router.get('/finance/status', financeReportController.getFeeStatusReport);
router.get('/finance/debtors', financeReportController.getDebtorsList);

// Health Reports
router.get('/health', healthReportController.getHealthDashboard);
router.get('/health/alerts', healthReportController.getMedicalAlerts);
router.get('/health/contacts', healthReportController.getEmergencyContacts);

// Legacy / Migration (Audit can stay for now or move to mainReportController if simple)
router.get('/audit', isAdmin, reportController.getAuditLogs);
router.get('/attendance', reportController.getAttendanceReports);
router.get('/fees', reportController.getFeeReports);
router.get('/staff', isAdmin, reportController.getStaffReports);
router.get('/health', reportController.getHealthReports);

module.exports = router;
