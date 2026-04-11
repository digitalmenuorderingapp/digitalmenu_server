const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth.middleware');

// Public routes (for customers with deviceId)
router.get('/public', notificationController.getNotifications);
router.post('/public/mark-read', notificationController.markAsRead);
router.get('/public/unread-count', notificationController.getUnreadCount);

// Protected routes (for admins)
router.get('/', protect, notificationController.getNotifications);
router.post('/mark-read', protect, notificationController.markAsRead);
router.get('/unread-count', protect, notificationController.getUnreadCount);
router.delete('/clear-all', protect, notificationController.clearAll);

module.exports = router;
