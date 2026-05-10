const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcementController');
const { isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, 'announcement-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

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
