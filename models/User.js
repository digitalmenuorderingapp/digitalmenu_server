const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationCode: {
    type: String,
    default: null
  },
  verificationCodeExpires: {
    type: Date,
    default: null
  },
  resetPasswordOtp: {
    type: String,
    default: null
  },
  resetPasswordOtpExpires: {
    type: Date,
    default: null
  },
  deleteAccountOtp: {
    type: String,
    default: null
  },
  deleteAccountOtpExpires: {
    type: Date,
    default: null
  },
  refreshToken: {
    type: String,
    default: null
  },
  // Restaurant Details
  restaurantName: {
    type: String,
    default: ''
  },
  ownerName: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  logo: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'superadmin'],
    default: 'user'
  },
  otp: {
    type: String,
    default: null
  },
  otpExpires: {
    type: Date,
    default: null
  },
  // Superadmin Management
  // Subscription Engine (Improved Structure)
  subscription: {
    type: { 
      type: String, 
      enum: ['free', 'paid'], 
      default: 'free' 
    },
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'expired'], 
      default: 'active' 
    },
    startDate: { 
      type: Date, 
      default: Date.now 
    },
    expiryDate: { 
      type: Date, 
      default: null 
    }
  },
  // Superadmin Management
  lastLogin: Date,
  lastActivity: Date,
  requestCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
