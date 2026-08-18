const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const portalController = require('../controllers/portalController');

// Multer config for profile photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'public', 'uploads'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `student_${req.session.student.id}_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// Main dashboard
router.get('/', portalController.getDashboard);

// Results views
router.get('/results', portalController.getResults);
router.get('/results/termly', portalController.viewTermlyResult);
router.get('/results/cumulative', portalController.viewCumulativeResult);

// Settings
router.get('/change-password', portalController.getChangePassword);
router.post('/change-password', portalController.postChangePassword);

// Calendar
router.get('/calendar', portalController.getCalendar);

// Announcements
router.get('/announcement/:id', portalController.viewAnnouncement);

// Assignments / Class posts
router.get('/assignment/:id', portalController.viewAssignment);

// Profile (self-service)
router.get('/profile', portalController.getProfile);
router.post('/profile', upload.single('passport'), portalController.postUpdateProfile);

module.exports = router;
