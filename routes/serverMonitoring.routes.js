const express = require('express');
const router = express.Router();
const serverMonitoringController = require('../controllers/serverMonitoring.controller');
const { 
  getCloudinaryStats, 
  getMongoStats, 
  getAuditLogs 
} = require('../controllers/superadmin.controller');
const { superadminProtect } = require('../middleware/superadmin.middleware');
const { trackRequest } = require('../controllers/serverMonitoring.controller');

// Apply request tracking to all routes
router.use(trackRequest);

// Current real-time stats
// Current real-time stats moved to superadmin.routes.js

// Daily usage data
router.get('/daily-usage', serverMonitoringController.getDailyUsage);

// Peak usage times
router.get('/peak-usage', serverMonitoringController.getPeakUsageTimes);

// Endpoint performance
router.get('/endpoint-performance', serverMonitoringController.getEndpointPerformance);

// Detailed usage analysis
router.get('/usage-analysis', serverMonitoringController.getUsageAnalysis);

// Health summary
router.get('/health-summary', superadminProtect, serverMonitoringController.getHealthSummary);

// Usage stats (Moved from superadmin)
router.get('/cloudinary-stats', superadminProtect, getCloudinaryStats);
router.get('/mongo-stats', superadminProtect, getMongoStats);

// System Logs (Moved from superadmin)
router.get('/logs', superadminProtect, getAuditLogs);

module.exports = router;
