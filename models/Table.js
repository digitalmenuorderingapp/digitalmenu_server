const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tableNumber: {
    type: Number,
    required: [true, 'Table number is required'],
    min: [1, 'Table number must be at least 1']
  },
  seats: {
    type: Number,
    required: [true, 'Number of seats is required'],
    min: [1, 'Seats must be at least 1'],
    default: 4
  },
  qrCode: {
    type: String,
    required: [true, 'QR code URL is required']
  }
}, {
  timestamps: true
});

// Compound index for unique table numbers per restaurant
tableSchema.index({ restaurant: 1, tableNumber: 1 }, { unique: true });
tableSchema.index({ restaurant: 1, createdAt: -1 });

module.exports = mongoose.model('Table', tableSchema);
