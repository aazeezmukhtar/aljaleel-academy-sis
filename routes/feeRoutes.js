const express = require('express');
const router = express.Router();
const feeController = require('../controllers/feeController');

// Fee Setup
router.get('/setup', feeController.getSetup);
router.post('/setup/add', feeController.addFeeCategory);

// Fee Management
router.get('/manager', feeController.getFeeManager);
router.get('/student/:student_id', feeController.getStudentFees);
router.post('/student/assign', feeController.assignFee);

// Payments
router.get('/pay/:student_fee_id', feeController.getPayForm);
router.post('/pay', feeController.processPayment);
router.get('/receipt/:receipt_number', feeController.getReceipt);

module.exports = router;
