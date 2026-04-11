const notificationService = require('../services/notification.service');
const Notification = require('../models/Notification');

/**
 * Get notifications for the current user/device
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const { recipientType } = req.query; // ADMIN or CUSTOMER
    const recipient = recipientType === 'ADMIN' ? req.userId : req.query.deviceId;

    if (!recipient) {
      return res.status(400).json({ success: false, message: 'Recipient ID is required' });
    }

    const notifications = await Notification.find({ recipient })
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await notificationService.getUnreadCount(recipient);

    res.json({
      success: true,
      data: notifications,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark notifications as read
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const { notificationIds, recipientType, deviceId } = req.body;
    const recipient = recipientType === 'ADMIN' ? req.userId : deviceId;

    if (!recipient) {
      return res.status(400).json({ success: false, message: 'Recipient ID is required' });
    }

    await notificationService.markAsRead(recipient, notificationIds);

    res.json({
      success: true,
      message: 'Notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get unread count only
 */
exports.getUnreadCount = async (req, res, next) => {
  try {
    const { recipientType, deviceId } = req.query;
    const recipient = recipientType === 'ADMIN' ? req.userId : deviceId;

    if (!recipient) {
      return res.status(400).json({ success: false, message: 'Recipient ID is required' });
    }

    const unreadCount = await notificationService.getUnreadCount(recipient);

    res.json({
      success: true,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
};
