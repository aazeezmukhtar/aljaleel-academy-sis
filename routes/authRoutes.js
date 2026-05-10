const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// --- Staff Authentication ---
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/logout', authController.logout);

// --- Student Authentication ---
router.get('/student-login', authController.getStudentLogin);
router.post('/student-login', authController.postStudentLogin);
router.get('/student-logout', authController.studentLogout);

router.get('/change-password', authController.getChangePassword);
router.post('/change-password', authController.postChangePassword);

module.exports = router;
