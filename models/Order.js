const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    max: 99
  }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  // Order Identification
  orderNumber: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    match: /^\d{5}$/
  },

  // Restaurant & Table
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tableNumber: {
    type: Number,
    required: function() {
      return this.orderType === 'dine-in';
    },
    min: 1,
    max: 999
  },
  orderType: {
    type: String,
    enum: ['dine-in', 'takeaway', 'delivery'],
    default: 'dine-in',
    required: true,
    index: true
  },

  // Customer Information
  customerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  customerPhone: {
    type: String,
    trim: true,
    match: /^$|^[+]?[\d\s-()]{10,15}$/ // Allow empty string or valid phone number
  },
  numberOfPersons: {
    type: Number,
    required: false,
    min: 1,
    max: 20,
    default: 1
  },

  // Session & Device Tracking
  deviceId: {
    type: String,
    required: true,
    index: true,
    maxlength: 100
  },
  sessionId: {
    type: String,
    required: true,
    index: true,
    maxlength: 100
  },

  // Order Details
  items: {
    type: [orderItemSchema],
    required: true,
    validate: {
      validator: function (v) {
        return v && v.length > 0;
      },
      message: 'Order must contain at least one item'
    }
  },
  totalAmount: Number,

  status: {
    type: String,
    enum: ['placed', 'preparing', 'served', 'rejected', 'cancelled'],
    default: 'placed',
    index: true
  },

  paymentMethod: {
    type: String,
    enum: ['cash', 'online'],
    required: true,
    index: true
  },

  paymentStatus: {
    type: String,
    enum: ['PENDING', 'VERIFIED'],
    default: 'PENDING',
    index: true
  },

  utrNumber: String,

  refund: {
    status: {
      type: String,
      enum: ['none', 'pending', 'refunded'],
      default: 'none',
      index: true
    },
    amount: Number,
    method: {
      type: String,
      enum: ['cash', 'online']
    },
    processedAt: Date
  },

  // Special Instructions
  specialInstructions: {
    type: String,
    trim: true,
    maxlength: 500
  },

  // Rejection & Cancellation (Kept for business logic)
  rejectionReason: String,
  cancellationReason: String,

  // Customer Feedback
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator: function (v) {
          // If rating is provided, comment should also be provided
          if (v && !this.feedback?.comment) {
            return false;
          }
          return true;
        },
        message: 'Comment is required when providing a rating'
      }
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      validate: {
        validator: function (v) {
          // If comment is provided, rating should also be provided
          if (v && !this.feedback?.rating) {
            return false;
          }
          return true;
        },
        message: 'Rating is required when providing a comment'
      }
    },
    submittedAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for order duration
orderSchema.virtual('orderDuration').get(function () {
  if (this.status === 'served' && this.updatedAt) {
    return Math.floor((this.updatedAt - this.createdAt) / (1000 * 60)); // in minutes
  }
  return null;
});

// Virtual for formatted total amount
orderSchema.virtual('formattedTotal').get(function () {
  return `₹${this.totalAmount.toFixed(2)}`;
});

// Generate unique 5-digit order number before saving
orderSchema.pre('save', async function (next) {
  if (this.isNew && !this.orderNumber) {
    let isUnique = false;
    let orderNumber;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      // Generate random 5-digit number (10000-99999)
      orderNumber = Math.floor(10000 + Math.random() * 90000).toString();

      // Check if it already exists
      const existingOrder = await mongoose.model('Order').findOne({ orderNumber });
      if (!existingOrder) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return next(new Error('Failed to generate unique order number after multiple attempts'));
    }

    this.orderNumber = orderNumber;
  }

  // Set refund processed date when refund is marked as refunded
  if (this.isModified('refund.status') && this.refund.status === 'refunded' && !this.refund.processedAt) {
    this.refund.processedAt = new Date();
  }

  next();
});

// Compound indexes for efficient queries
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ restaurant: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, tableNumber: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, deviceId: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, status: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, paymentStatus: 1 });
orderSchema.index({ restaurant: 1, 'refund.status': 1 });
orderSchema.index({ createdAt: -1 });

// Text index for searching
orderSchema.index({
  orderNumber: 'text',
  customerName: 'text',
  'items.name': 'text'
});

module.exports = mongoose.model('Order', orderSchema);
