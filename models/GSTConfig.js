const mongoose = require('mongoose');

const gstConfigSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RestaurantAdmin',
    required: true,
    unique: true,
    index: true
  },
  sgstPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  cgstPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  igstPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  serviceChargePercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  gstEnabled: {
    type: Boolean,
    default: false
  },
  serviceChargeEnabled: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GSTConfig', gstConfigSchema);
