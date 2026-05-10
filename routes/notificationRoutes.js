const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

router.get('/latest', notificationController.getLatestNotifications);
router.post('/mark-read', notificationController.markAsRead);

module.exports = router;
