const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: String, // Can be RestaurantAdmin ObjectId or DeviceId string
    required: true,
    index: true
  },
  recipientType: {
    type: String,
    required: true,
    enum: ['ADMIN', 'CUSTOMER']
  },
  type: {
    type: String,
    required: true,
    enum: [
      'ORDER_NEW', 
      'ORDER_UPDATE', 
      'ORDER_ACCEPTED', 
      'ORDER_PREPARED',
      'ORDER_REJECTED', 
      'ORDER_CANCELLED',
      'ORDER_COMPLETED',
      'PAYMENT_VERIFIED',
      'PAYMENT_RETRY',
      'ACCOUNT_STATUS'
    ]
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  metadata: {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    orderNumber: String,
    tableNumber: String,
    amount: Number,
    orderData: { type: mongoose.Schema.Types.Mixed }
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30 // Auto-delete after 30 days
  }
});

// Index for getting unread count quickly
notificationSchema.index({ recipient: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
