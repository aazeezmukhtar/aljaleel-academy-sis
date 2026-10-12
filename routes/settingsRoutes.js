// Production single‑tenant mode – no tenant filtering needed

const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');

// Memory storage — buffer forwarded to Supabase Storage in prod, local disk in dev
const upload = multer({
    storage: multer.memoryStorage(),
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

