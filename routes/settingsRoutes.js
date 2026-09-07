const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer for Image Upload
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// Protected Routes (Admin Only)
router.use(isAdmin);

// GET /settings
router.get('/', settingsController.getSettingsPage);

// POST /settings/update
router.post('/update', upload.single('school_logo'), settingsController.updateSettings);

// Promotion Routes
router.get('/promotion', settingsController.getPromotionPage);
router.post('/promotion/preview', settingsController.previewPromotion);
router.post('/promotion', settingsController.processPromotion);

// Section Calendar Routes
router.post('/section-calendar', settingsController.updateSectionCalendar);

module.exports = router;

