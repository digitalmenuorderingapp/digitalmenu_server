const express = require('express');
const router = express.Router();
const devicesController = require('../controllers/devices.controller');
const { protect } = require('../middleware/auth.middleware');

// Get all devices with login/logout history
router.get('/', protect, devicesController.getDevices);

// Get specific device activity details
router.get('/:deviceId', protect, devicesController.getDeviceActivity);

// Revoke a specific device (logout)
router.delete('/:deviceId', protect, devicesController.revokeDevice);

// Permanently remove ALL OTHER devices except current
router.delete('/remove/all-others', protect, devicesController.removeAllOtherDevices);

// Permanently remove a specific device entry
router.delete('/:deviceId/remove', protect, devicesController.removeDevice);

// Get device statistics
router.get('/stats/summary', protect, devicesController.getDeviceStats);

module.exports = router;
