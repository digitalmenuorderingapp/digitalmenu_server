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
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  ingredients: {
    type: String,
    trim: true,
    maxlength: [300, 'Ingredients cannot exceed 300 characters']
  },
  preparationMethod: {
    type: String,
    trim: true,
    maxlength: [300, 'Preparation method cannot exceed 300 characters']
  },
  image: {
    type: String,
    default: null
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  offerPrice: {
    type: Number,
    min: [0, 'Offer price cannot be negative'],
    default: null
  },
  discountPercentage: {
    type: Number,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100'],
    default: 0
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
  }
}, {
  timestamps: true
});

// Calculate discount percentage before saving
menuItemSchema.pre('save', function(next) {
  if (this.offerPrice && this.price > 0) {
    this.discountPercentage = Math.round(((this.price - this.offerPrice) / this.price) * 100);
  } else {
    this.discountPercentage = 0;
  }
  next();
});

// Update discount on update
menuItemSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update.offerPrice !== undefined && update.price !== undefined) {
    if (update.offerPrice && update.price > 0) {
      update.discountPercentage = Math.round(((update.price - update.offerPrice) / update.price) * 100);
    } else if (update.price > 0) {
      update.discountPercentage = 0;
    }
  } else if (update.offerPrice !== undefined) {
    // Need to get current price from document
    this.model.findOne(this.getQuery()).then(doc => {
      const price = update.price !== undefined ? update.price : doc.price;
      if (update.offerPrice && price > 0) {
        update.discountPercentage = Math.round(((price - update.offerPrice) / price) * 100);
      } else {
        update.discountPercentage = 0;
      }
      this.setUpdate(update);
      next();
    });
    return;
  }
  next();
});

// Indexes for efficient queries
menuItemSchema.index({ restaurant: 1, isActive: 1 });
menuItemSchema.index({ restaurant: 1, name: 1 });
menuItemSchema.index({ restaurant: 1, createdAt: -1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
