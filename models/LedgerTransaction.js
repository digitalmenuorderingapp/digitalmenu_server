const mongoose = require('mongoose');

const ledgerTransactionSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    index: true
  },

  type: {
    type: String,
    enum: ['PAYMENT', 'REFUND'],
    required: true
  },

  paymentMode: {
    type: String,
    enum: ['CASH', 'ONLINE'],
    required: true
  },

  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED'],
    default: 'PENDING'
  },

  amount: {
    type: Number,
    required: true // +ve = payment, -ve = refund
  },

  transactionDate: {
    type: Date,
    required: true,
    index: true
  },

  meta: {
    orderNumber: String,
    tableNumber: Number,
    deviceId: String,
    utr: String
  },

  netBalance: {
    type: Number,
    default: 0
  },

  monthlyNetBalance: {
    type: Number,
    default: 0
  }

}, { timestamps: true });

// Ensure transactionDate is at midnight IST for daily grouping in queries if needed
// but usually we want exact time for transactions. 
// We'll use this for daily aggregation.

ledgerTransactionSchema.index({ restaurant: 1, transactionDate: -1 });
ledgerTransactionSchema.index({ orderId: 1 });

module.exports = mongoose.model('LedgerTransaction', ledgerTransactionSchema);
