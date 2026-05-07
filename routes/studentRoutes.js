const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const bulkStudentController = require('../controllers/bulkStudentController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// GET /students
router.get('/', studentController.getStudents);

// GET /students/enroll (Form)
router.get('/enroll', studentController.getEnrollmentForm);

// POST /students/enroll (Action)
router.post('/enroll', upload.single('passport'), studentController.enrollStudent);

// GET /students/view/:id
router.get('/view/:id', studentController.getStudentProfile);

// GET /students/edit/:id
router.get('/edit/:id', studentController.getEditForm);

// POST /students/update/:id
router.post('/update/:id', upload.single('passport'), studentController.updateStudent);

// Bulk Import Routes
router.get('/bulk-import', bulkStudentController.getBulkImportPage);
router.post('/bulk-import', upload.single('studentFile'), bulkStudentController.processBulkImport);

// Health Record
router.post('/health', studentController.saveHealthRecord);

module.exports = router;
