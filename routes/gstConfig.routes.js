const express = require('express');
const router = express.Router();
const gstConfigController = require('../controllers/gstConfig.controller');
const { protect } = require('../middleware/auth.middleware');
const { trackActivity } = require('../middleware/activity.middleware');

// Protected admin routes
router.use(protect, trackActivity);

// Get GST config
router.get('/', gstConfigController.getGSTConfig);

// Update GST config
router.put('/', gstConfigController.updateGSTConfig);

module.exports = router;
