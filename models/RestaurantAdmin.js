const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Sub-schema for refresh tokens (multi-device support)
const refreshTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true },
  deviceId: { type: String, required: true },
  deviceName: { type: String },
  ipAddress: { type: String },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  issuedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  revokedAt: { type: Date },
  sessions: [{
    loggedInAt: { type: Date, required: true },
    loggedOutAt: { type: Date },
    duration: { type: Number } // Seconds
  }]
}, { _id: false });

const restaurantAdminSchema = new mongoose.Schema({
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
  // Embedded refresh tokens for multi-device session management
  refreshTokens: [refreshTokenSchema],
  
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
    enum: ['user', 'admin', 'moderator'], // 'user' is legacy, we use 'admin' mostly now
    default: 'admin'
  },
  otp: {
    type: String,
    default: null
  },
  otpExpires: {
    type: Date,
    default: null
  },
  subscription: {
    type: { 
      type: String, 
      enum: ['trial', 'paid', 'free'], 
      default: 'trial' 
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
  lastLogin: Date,
  lastActivity: Date,
  requestCount: {
    type: Number,
    default: 0
  },
  shortId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true
  }
}, {
  timestamps: true,
});

// Index for efficient lookups
restaurantAdminSchema.index({ shortId: 1 });
restaurantAdminSchema.index({ 'refreshTokens.deviceId': 1 });
restaurantAdminSchema.index({ 'refreshTokens.tokenHash': 1 });

// Hash password before saving
restaurantAdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
restaurantAdminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Static method to mark inactive devices offline
restaurantAdminSchema.statics.markInactiveDevicesOffline = async function () {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  
  return this.updateMany(
    { 'refreshTokens.lastSeen': { $lt: fifteenMinutesAgo }, 'refreshTokens.isOnline': true },
    { $set: { 'refreshTokens.$[elem].isOnline': false } },
    { arrayFilters: [{ 'elem.lastSeen': { $lt: fifteenMinutesAgo }, 'elem.isOnline': true }] }
  );
};

module.exports = mongoose.model('RestaurantAdmin', restaurantAdminSchema);
