const express = require('express');
const router = express.Router();
const resultController = require('../controllers/resultController');
const importController = require('../controllers/importController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// GET /results - Dashboard
router.get('/', resultController.getResultsDashboard);

// GET /results/manage - Manager Sheet
router.get('/manage', resultController.getResultManager);

// POST /results/save - Batch Save
router.post('/save', resultController.saveResults);

// Admin Setup Routes
router.get('/setup', resultController.getGradingSystem);
router.post('/setup/config', resultController.saveResultConfig);
router.post('/setup/grading', resultController.saveGradingSystem);
router.post('/approve', resultController.approveResults);
router.post('/lock', resultController.lockResults);
router.post('/publish-bulk', resultController.publishBulkResults);

// GET /results/report/:student_id - Printable Report
router.get('/report/:student_id', resultController.getReportCard);
router.get('/bulk', resultController.getBulkReport);
router.get('/traits', resultController.getTraitsForm);
router.post('/traits/save', resultController.saveTraits);
router.get('/cumulative/:student_id', resultController.getCumulativeReport);
router.get('/bulk-cumulative', resultController.getBulkCumulative);

// Bulk Import Routes
router.get('/bulk-import', importController.getImportPage);
router.get('/bulk-import/template', importController.downloadTemplate);
router.post('/bulk-import', upload.single('resultFile'), importController.processImport);

module.exports = router;

