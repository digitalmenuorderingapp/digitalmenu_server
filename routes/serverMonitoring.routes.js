const express = require('express');
const router = express.Router();
const serverMonitoringController = require('../controllers/serverMonitoring.controller');
const { trackRequest } = require('../controllers/serverMonitoring.controller');

// Apply request tracking to all routes
router.use(trackRequest);

// Current real-time stats
router.get('/current-stats', serverMonitoringController.getCurrentStats);

// Daily usage data
router.get('/daily-usage', serverMonitoringController.getDailyUsage);

// Peak usage times
router.get('/peak-usage', serverMonitoringController.getPeakUsageTimes);

// Endpoint performance
router.get('/endpoint-performance', serverMonitoringController.getEndpointPerformance);

// Detailed usage analysis
router.get('/usage-analysis', serverMonitoringController.getUsageAnalysis);

// Health summary
router.get('/health-summary', serverMonitoringController.getHealthSummary);

module.exports = router;
