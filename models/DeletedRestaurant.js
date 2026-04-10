const mongoose = require('mongoose');

const deletedRestaurantSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  subscription: {
    type: Object,
    required: true
  },
  deletionReason: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  } // Not expiring so the user preserves their subscription forever, as discussed
});

module.exports = mongoose.model('DeletedRestaurant', deletedRestaurantSchema);
