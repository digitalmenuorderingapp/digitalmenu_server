const express = require('express');
const router = express.Router();
const { 
  requestOTP, 
  verifyOTP, 
  googleSignIn,
  autoLogin,
  getRestaurants,
  getRestaurantDetail,
  updateRestaurantStatus,
  updateSubscription,
  refreshSuperadminToken,
  logout,
  getMe,
  triggerMonthlyReports
} = require('../controllers/superadmin.controller');
const { getCurrentStats } = require('../controllers/serverMonitoring.controller');
const { superadminProtect } = require('../middleware/superadmin.middleware');

// Public superadmin routes
router.post('/send-otp', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/google-signin', googleSignIn);
router.post('/auto-login', autoLogin);
router.post('/refresh', refreshSuperadminToken);
router.post('/logout', logout);

// Protected superadmin routes
router.get('/me', superadminProtect, getMe);
router.get('/current-stats', superadminProtect, getCurrentStats); // Better consolidated metrics
router.get('/restaurants', superadminProtect, getRestaurants);
router.get('/restaurant/:id', superadminProtect, getRestaurantDetail);
router.patch('/restaurants/:restaurantId/status', superadminProtect, updateRestaurantStatus);
router.patch('/restaurants/:restaurantId/subscription', superadminProtect, updateSubscription);
router.post('/trigger-monthly-reports', superadminProtect, triggerMonthlyReports);

module.exports = router;
