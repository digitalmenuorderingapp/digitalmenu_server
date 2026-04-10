const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

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

const superadminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please enter a valid email']
  },
  name: {
    type: String,
    default: 'System Admin'
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'moderator'],
    default: 'superadmin'
  },
  otp: {
    type: String,
    default: null
  },
  otpExpires: {
    type: Date,
    default: null
  },
  googleRefreshToken: {
    type: String,
    default: null
  },
  // Embedded refresh tokens for multi-device session management
  refreshTokens: [refreshTokenSchema],
  systemLogs: [systemLogSchema]
}, {
  timestamps: true
});

// Index for efficient token lookups
superadminSchema.index({ 'refreshTokens.deviceId': 1 });
superadminSchema.index({ 'refreshTokens.tokenHash': 1 });

// Static method to mark inactive devices offline
superadminSchema.statics.markInactiveDevicesOffline = async function () {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  
  return this.updateMany(
    { 'refreshTokens.lastSeen': { $lt: fifteenMinutesAgo }, 'refreshTokens.isOnline': true },
    { $set: { 'refreshTokens.$[elem].isOnline': false } },
    { arrayFilters: [{ 'elem.lastSeen': { $lt: fifteenMinutesAgo }, 'elem.isOnline': true }] }
  );
};

module.exports = mongoose.model('Superadmin', superadminSchema);
