const mongoose = require('mongoose');

const dailyLedgerSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RestaurantAdmin',
    required: true,
    index: true
  },

  date: {
    type: Date,
    required: true,
    index: true
  },

  // Financial Summary (Truth from LedgerTransactions)
  counter: {
    received: { type: Number, default: 0 },
    verified: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    balance: { type: Number, default: 0 }
  },
  online: {
    received: { type: Number, default: 0 },
    verified: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    balance: { type: Number, default: 0 }
  },
  total: {
    received: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    netBalance: { type: Number, default: 0 },
    unpaidDues: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 }
  },

  // Operational Stats
  counts: {
    totalOrders: { type: Number, default: 0 },
    servedOrders: { type: Number, default: 0 },
    rejectedOrders: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 }
  },

  // Business Analytics (Truth from Order items)
  soldItems: [{
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    name: String,
    count: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 }
  }],

  hourlyBreakdown: [{
    hour: Number, // 0-23
    orders: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    servedOrders: { type: Number, default: 0 }
  }],

  lastUpdated: {
    type: Date,
    default: Date.now
  }

}, { timestamps: true });

// IST Normalization
const normalizeToISTMidnight = (date) => {
  const d = new Date(date);
  const istStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
  const [m, d1, y] = istStr.split('/');
  return new Date(`${y}-${m.padStart(2, '0')}-${d1.padStart(2, '0')}T00:00:00+05:30`);
};

dailyLedgerSchema.pre('save', function(next) {
  if (this.isModified('date')) {
    this.date = normalizeToISTMidnight(this.date);
  }
  this.lastUpdated = new Date();
  next();
});

// Static method to get or create daily ledger
dailyLedgerSchema.statics.getOrCreateLedger = async function(date, restaurantId) {
  const normalizedDate = normalizeToISTMidnight(date);
  let ledger = await this.findOne({ date: normalizedDate, restaurant: restaurantId });

  if (!ledger) {
    // Initialize hourly breakdown
    const hourlyBreakdown = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      orders: 0,
      revenue: 0,
      servedOrders: 0
    }));

    ledger = new this({
      date: normalizedDate,
      restaurant: restaurantId,
      hourlyBreakdown
    });
  }
  return ledger;
};

module.exports = mongoose.model('DailyLedger', dailyLedgerSchema);
