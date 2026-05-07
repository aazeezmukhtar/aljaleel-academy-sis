const express = require('express');
const router = express.Router();
const portalController = require('../controllers/portalController');

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

module.exports = router;
