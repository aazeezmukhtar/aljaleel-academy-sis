const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcementController');
const { isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');

// Memory storage — buffer forwarded to Supabase Storage in prod, local disk in dev
const upload = multer({ storage: multer.memoryStorage() });


// View (Accessible by all)
router.get('/view/:id', announcementController.viewAnnouncement);

// Protected Admin Routes
router.use(isAdmin);

// Dashboard
router.get('/', announcementController.getIndex);

// Create / Store
router.get('/create', announcementController.createAnnouncement);
router.post('/create', upload.single('image'), announcementController.storeAnnouncement);

// Manage
router.post('/delete/:id', announcementController.deleteAnnouncement);
router.post('/toggle/:id', announcementController.toggleAnnouncement);

module.exports = router;
