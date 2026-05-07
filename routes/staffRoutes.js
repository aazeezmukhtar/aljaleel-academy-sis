const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { isAdmin } = require('../middleware/authMiddleware');
const path = require('path');
const multer = require('multer');

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const prefix = file.fieldname === 'avatar_image' ? 'staff-' : 'board-';
        cb(null, prefix + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

router.get('/', staffController.getAllStaff);
router.get('/add', isAdmin, staffController.addStaffForm);
router.post('/add', isAdmin, upload.single('avatar_image'), staffController.saveStaff);
router.get('/view/:id', staffController.getStaffProfile);
router.get('/edit/:id', isAdmin, staffController.getEditForm);
router.post('/update/:id', isAdmin, upload.single('avatar_image'), staffController.updateStaff);
router.post('/assign-class', isAdmin, staffController.assignClass);
router.post('/assign-subject', isAdmin, staffController.assignSubject);
router.post('/delete-assignment/:id', isAdmin, staffController.deleteAssignment);
router.post('/delete/:id', isAdmin, staffController.deleteStaff);

// Board Routes
router.get('/board', staffController.getClassBoard);
router.post('/board/post', upload.single('attachment'), staffController.postClassBoard);
router.post('/board/post/delete/:id', staffController.deleteClassBoardPost);

module.exports = router;
