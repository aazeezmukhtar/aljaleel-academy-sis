const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const bulkStudentController = require('../controllers/bulkStudentController');
const { isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'student-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// GET /students
router.get('/', studentController.getStudents);

// GET /students/enroll (Form) ΓÇö Admin and Registrar only (checked inside controller)
router.get('/enroll', studentController.getEnrollmentForm);

// POST /students/enroll (Action) ΓÇö Admin and Registrar only (enforced via controller role check)
router.post('/enroll', upload.single('passport'), studentController.enrollStudent);

// GET /students/view/:id
router.get('/view/:id', studentController.getStudentProfile);

// GET /students/edit/:id
router.get('/edit/:id', studentController.getEditForm);

// POST /students/update/:id ΓÇö Admin and Registrar only (enforced via controller role check)
router.post('/update/:id', upload.single('passport'), studentController.updateStudent);

// POST /students/delete/:id ΓÇö Admin only
router.post('/delete/:id', isAdmin, studentController.deleteStudent);

// POST /students/reset-password/:id ΓÇö Admin only
router.post('/reset-password/:id', isAdmin, studentController.resetStudentPassword);

// Bulk Import Routes ΓÇö Admin only
router.get('/bulk-import', isAdmin, bulkStudentController.getBulkImportPage);
router.post('/bulk-import', isAdmin, upload.single('studentFile'), bulkStudentController.processBulkImport);

// Health Record ΓÇö Admin and Registrar only (enforced via controller role check)
router.post('/health', studentController.saveHealthRecord);

module.exports = router;



