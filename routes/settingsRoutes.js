const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const multer = require('multer');
const path = require('path');

// Configure Multer for Image Upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads';
        // Create directory if it doesn't exist
        if (!require('fs').existsSync(uploadDir)) {
            require('fs').mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Use a fixed name 'logo' + extension to avoiding piling up logos
        // Or unique name logic. Let's use unique name for cache busting but save ref in DB
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

// GET /settings
router.get('/', settingsController.getSettingsPage);

// POST /settings/update
router.post('/update', upload.single('school_logo'), settingsController.updateSettings);

module.exports = router;
