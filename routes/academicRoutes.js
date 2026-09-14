const express = require('express');
const router = express.Router();
const academicController = require('../controllers/academicController');
const { isAdmin } = require('../middleware/authMiddleware');

router.get('/', academicController.getAcademicDashboard);

// Classes ΓÇö Admin only
router.post('/classes/add', isAdmin, academicController.addClass);
router.post('/classes/update/:id', isAdmin, academicController.updateClass);
router.post('/classes/delete/:id', isAdmin, academicController.deleteClass);


// Subjects ΓÇö Admin only
router.post('/subjects/add', isAdmin, academicController.addSubject);
router.get('/subjects/edit/:id', academicController.editSubjectForm);
router.post('/subjects/update/:id', isAdmin, academicController.updateSubject);
router.post('/subjects/delete/:id', isAdmin, academicController.deleteSubject);

// Subject Assignment Management ΓÇö Admin only
router.post('/assignments/add', isAdmin, academicController.addAssignment);
router.post('/assignments/delete/:id', isAdmin, academicController.deleteAssignment);

module.exports = router;



