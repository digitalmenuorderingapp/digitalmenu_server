const Notification = require('../models/Notification');
const socketService = require('./socket.service');

/**
 * Notification Service - Centralized handler for system notifications
 */
class NotificationService {
  /**
   * Send a notification to a specific recipient
   * @param {Object} params - Notification parameters
   */
  async send({
    recipient,
    recipientType,
    type,
    title,
    message,
    metadata = {}
  }) {
    try {
      // 1. Save to Database for persistence
      const notification = await Notification.create({
        recipient,
        recipientType,
        type,
        title,
        message,
        metadata
      });

      // 2. Emit Real-time Socket Event
      const roomNamespace = recipientType === 'ADMIN' ? `restaurant:${recipient}` : `customer:${recipient}`;
      socketService.emitToRoom(roomNamespace, 'notification', notification);
      
      // Specifically for original event names if needed for compatibility
      if (type === 'ORDER_NEW') {
        socketService.emitToRoom(roomNamespace, 'newOrder', metadata.orderData || metadata.orderId);
      } else if (type === 'ORDER_UPDATE' || type.startsWith('ORDER_')) {
        socketService.emitToRoom(roomNamespace, 'orderUpdate', metadata.orderData || metadata.orderId);
        // Also notify customer if deviceId is provided
        if (metadata.deviceId) {
           socketService.emitToRoom(`customer:${metadata.deviceId}`, 'orderStatusUpdate', metadata.orderData || metadata.orderId);
        }
      } else if (type === 'ACCOUNT_STATUS') {
        socketService.emitToRoom(roomNamespace, 'accountStatusUpdate', notification);
      }

      return notification;
    } catch (error) {
      console.error('[NotificationService] Failed to send notification:', error);
      // We don't throw error to prevent breaking the main request flow
      return null;
    }
  }

  /**
   * Get unread notification count for a recipient
   */
  async getUnreadCount(recipient) {
    return await Notification.countDocuments({ recipient, isRead: false });
  }

  /**
   * Mark notifications as read
   */
  async markAsRead(recipient, notificationIds = []) {
    const query = { recipient };
    if (notificationIds.length > 0) {
      query._id = { $in: notificationIds };
    }
    return await Notification.updateMany(query, { $set: { isRead: true } });
  }
}

module.exports = new NotificationService();
