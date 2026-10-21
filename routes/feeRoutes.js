const express = require('express');
const router = express.Router();
const feeController = require('../controllers/feeController');
const { isAdminOrBursar } = require('../middleware/authMiddleware');

// Fee setup and changes affect school-wide financial configuration.
router.get('/setup', isAdminOrBursar, feeController.getSetup);
router.post('/setup/add', isAdminOrBursar, feeController.addFeeCategory);

// Existing controller checks preserve assigned-class, read-only access for teachers.
router.get('/manager', feeController.getFeeManager);
router.get('/student/:student_id', feeController.getStudentFees);

// Assigning charges, viewing payment forms, recording payments, and receipts are restricted.
router.post('/student/assign', isAdminOrBursar, feeController.assignFee);
router.get('/pay/:student_fee_id', isAdminOrBursar, feeController.getPayForm);
router.post('/pay', isAdminOrBursar, feeController.processPayment);
router.get('/receipt/:receipt_number', isAdminOrBursar, feeController.getReceipt);

module.exports = router;
