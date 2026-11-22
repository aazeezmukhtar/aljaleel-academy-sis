const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const informationController = require('../controllers/staffInformationController');
const { isAdmin } = require('../middleware/authMiddleware');
const path = require('path');
const multer = require('multer');

// Memory storage — buffer sent to Supabase Storage in prod, written to disk in dev
const upload = multer({ storage: multer.memoryStorage() });


router.get('/my-profile', informationController.getMyProfile);
router.post('/my-profile/personal', informationController.savePersonalDetails);
router.post('/my-profile/emergency-contacts', informationController.addEmergencyContact);
router.post('/my-profile/emergency-contacts/:id/delete', informationController.deleteEmergencyContact);
router.post('/my-profile/qualifications', informationController.addQualification);
router.get('/information/:id', isAdmin, informationController.getStaffInformation);
router.post('/information/:id/employment', isAdmin, informationController.saveEmploymentDetails);
router.post('/qualifications/:id/review', isAdmin, informationController.verifyQualification);

router.get('/', staffController.getAllStaff);
router.get('/add', isAdmin, staffController.addStaffForm);
router.post('/add', isAdmin, upload.single('avatar_image'), staffController.saveStaff);
router.get('/view/:id', staffController.getStaffProfile);
router.get('/edit/:id', isAdmin, staffController.getEditForm);
router.post('/update/:id', isAdmin, upload.single('avatar_image'), staffController.updateStaff);
router.post('/assign-class', isAdmin, staffController.assignClass);
router.post('/assign-subject', isAdmin, staffController.assignSubject);
router.post('/delete-assignment/:id', isAdmin, staffController.deleteAssignment);
router.post('/delete/:id', isAdmin, staffController.deleteStaff);

// Board Routes
router.get('/board', staffController.getClassBoard);
router.post('/board/post', upload.single('attachment'), staffController.postClassBoard);
router.post('/board/post/delete/:id', staffController.deleteClassBoardPost);

module.exports = router;

