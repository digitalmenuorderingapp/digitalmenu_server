const express = require('express');
const router = express.Router();
const { 
  requestOTP, 
  verifyOTP, 
  autoLogin,
  getSystemStats,
  getRestaurants,
  getRestaurantDetail,
  updateRestaurantStatus,
  updateSubscription,
  refreshSuperadminToken,
  logout,
  getMe,
  getCloudinaryStats,
  getMongoStats,
  triggerMonthlyReports
} = require('../controllers/superadmin.controller');
const { superadminProtect } = require('../middleware/superadmin.middleware');

// Public superadmin routes
router.post('/send-otp', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/auto-login', autoLogin);
router.post('/refresh', refreshSuperadminToken);
router.post('/logout', logout);

// Protected superadmin routes
router.get('/me', superadminProtect, getMe);
router.get('/system-stats', superadminProtect, getSystemStats);
router.get('/restaurants', superadminProtect, getRestaurants);
router.get('/restaurant/:id', superadminProtect, getRestaurantDetail);
router.patch('/restaurants/:restaurantId/status', superadminProtect, updateRestaurantStatus);
router.patch('/restaurants/:restaurantId/subscription', superadminProtect, updateSubscription);
router.get('/cloudinary-stats', superadminProtect, getCloudinaryStats);
router.get('/mongo-stats', superadminProtect, getMongoStats);
router.post('/trigger-monthly-reports', superadminProtect, triggerMonthlyReports);

module.exports = router;
