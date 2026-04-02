const express = require('express');
const router = express.Router();
const { 
  requestOTP, 
  verifyOTP, 
  getSystemStats,
  getServiceStatus,
  getAnalytics,
  getOrdersOverview,
  getUsers,
  getUserDetail,
  updateUserStatus,
  updateSubscription,
  refreshSuperadminToken,
  logout,
  getAuditLogs,
  getMe
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
router.get('/users', superadminProtect, getUsers);
router.get('/user/:id', superadminProtect, getUserDetail);
router.patch('/users/:userId/status', superadminProtect, updateUserStatus);
router.patch('/users/:userId/subscription', superadminProtect, updateSubscription);
router.get('/logs', superadminProtect, getAuditLogs);

module.exports = router;
