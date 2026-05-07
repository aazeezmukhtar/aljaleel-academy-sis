const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { isStudentAuthenticated } = require('../middleware/studentAuthMiddleware');

// Middleware to allow either staff or student
const isAnyAuthenticated = (req, res, next) => {
    if ((req.session && req.session.staff) || (req.session && req.session.student)) {
        return next();
    }
    res.redirect('/auth/login');
};

// Viewing (Both Staff and Students)
router.get('/', isAnyAuthenticated, calendarController.getCalendar);

// Management (Admin Only)
router.get('/manage', isAdmin, calendarController.getManageCalendar);
router.post('/add', isAdmin, calendarController.createEvent);
router.post('/delete/:id', isAdmin, calendarController.deleteEvent);

module.exports = router;
