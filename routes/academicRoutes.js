const express = require('express');
const router = express.Router();
const academicController = require('../controllers/academicController');

router.get('/', academicController.getAcademicDashboard);

// Classes
router.post('/classes/add', academicController.addClass);
router.post('/classes/delete/:id', academicController.deleteClass);


// Subjects
router.post('/subjects/add', academicController.addSubject);
router.get('/subjects/edit/:id', academicController.editSubjectForm);
router.post('/subjects/update/:id', academicController.updateSubject);
router.post('/subjects/delete/:id', academicController.deleteSubject);

// Subject Assignment Management
router.post('/assignments/add', academicController.addAssignment);
router.post('/assignments/delete/:id', academicController.deleteAssignment);

module.exports = router;

