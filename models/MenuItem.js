const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RestaurantAdmin',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  images: {
    type: [String],
    default: []
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  foodType: {
    type: String,
    trim: true,
    enum: ['Cold Beverage', 'Hot Beverage', 'Appetizers', 'Soups', 'Salads', 'Main Course', 'Sides', 'Desserts'],
    default: 'Main Course'
  },
  isVeg: {
    type: Boolean,
    default: true
  },
  isBestSeller: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});


// Indexes for efficient queries
menuItemSchema.index({ restaurant: 1, isActive: 1 });
menuItemSchema.index({ restaurant: 1, name: 1 });
menuItemSchema.index({ restaurant: 1, createdAt: -1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
