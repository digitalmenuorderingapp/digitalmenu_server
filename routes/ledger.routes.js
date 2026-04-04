const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledger.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

// Unified daily summary routes (contains financials, counts, items, and hourly)
router.get('/today', ledgerController.getTodayLedger);
router.get('/date', ledgerController.getDailyLedger); // Use query param ?date=YYYY-MM-DD

// Monthly summary routes
router.get('/monthly', ledgerController.getMonthlyLedger); // ?month=1-12&year=2024 (optional, defaults to current month)

// Audit / Transaction detail routes
router.get('/transactions', ledgerController.getTransactions); // ?date=YYYY-MM-DD

// Management & Recalculation
router.post('/recalculate', ledgerController.recalculateLedger);

// Report Export
router.post('/exportreporttomail', ledgerController.exportReportToMail);

module.exports = router;
