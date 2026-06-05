const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');
const { isAuthenticated, isAdmin, isAnyAuthenticated } = require('../middleware/authMiddleware');
const { isStudentAuthenticated } = require('../middleware/studentAuthMiddleware');

// Viewing (Both Staff and Students)
router.get('/', isAnyAuthenticated, calendarController.getCalendar);

// Management (Admin Only)
router.get('/manage', isAdmin, calendarController.getManageCalendar);
router.post('/add', isAdmin, calendarController.createEvent);
router.post('/delete/:id', isAdmin, calendarController.deleteEvent);

module.exports = router;
