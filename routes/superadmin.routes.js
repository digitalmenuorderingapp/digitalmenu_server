const express = require('express');
const router = express.Router();
const { 
  requestOTP, 
  verifyOTP, 
  getSystemStats,
  getServiceStatus,
  getAnalytics,
  getOrdersOverview,
  getRestaurants,
  getRestaurantDetail,
  updateRestaurantStatus,
  updateSubscription,
  refreshSuperadminToken,
  logout,
  getAuditLogs,
  getMe,
  getCloudinaryStats,
  triggerMonthlyReports
} = require('../controllers/superadmin.controller');
const { superadminProtect } = require('../middleware/superadmin.middleware');

// Public superadmin routes
router.post('/send-otp', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/refresh', refreshSuperadminToken);
router.post('/logout', logout);

// Protected superadmin routes
router.get('/me', superadminProtect, getMe);
router.get('/system-stats', superadminProtect, getSystemStats);
router.get('/service-status', superadminProtect, getServiceStatus);
router.get('/analytics', superadminProtect, getAnalytics);
router.get('/orders-overview', superadminProtect, getOrdersOverview);
router.get('/restaurants', superadminProtect, getRestaurants);
router.get('/restaurant/:id', superadminProtect, getRestaurantDetail);
router.patch('/restaurants/:restaurantId/status', superadminProtect, updateRestaurantStatus);
router.patch('/restaurants/:restaurantId/subscription', superadminProtect, updateSubscription);
router.get('/logs', superadminProtect, getAuditLogs);
router.get('/cloudinary-stats', superadminProtect, getCloudinaryStats);
router.post('/trigger-monthly-reports', superadminProtect, triggerMonthlyReports);

module.exports = router;
