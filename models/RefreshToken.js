const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  deviceId: { type: String, required: true },
  deviceName: { type: String },       // e.g. "iPhone 14 Pro"
  locationCoords: { type: String },    // e.g. "{latitude: 22.5726, longitude: 88.3639}"
  locationName: { type: String },      // e.g. "Kolkata, India"
  ipAddress: { type: String },
  userAgent: { type: String },
  issuedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  revokedAt: { type: Date },
  isOnline: { type: Boolean, default: false }, // Track online status for WebSocket
  lastSeen: { type: Date, default: Date.now }, // Last activity timestamp

  // Sessions array (last 7 days only)
  sessions: [{
    loggedInAt: { type: Date, required: true },
    loggedOutAt: { type: Date },
    duration: { type: Number } // Duration in seconds
  }]
}, {
  timestamps: true
});

// Index for efficient queries
refreshTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
refreshTokenSchema.index({ deviceId: 1, lastSeen: -1 });
refreshTokenSchema.index({ userId: 1, isOnline: 1 });

// Method to start a new session
refreshTokenSchema.methods.startSession = function () {
  const session = {
    loggedInAt: new Date()
  };

  this.sessions.push(session);

  // Keep only last 7 days of sessions
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  this.sessions = this.sessions.filter(session => session.loggedInAt > sevenDaysAgo);

  // Update last seen and online status
  this.lastSeen = new Date();
  this.isOnline = true;

  return this.save();
};

// Method to end current session
refreshTokenSchema.methods.endCurrentSession = function () {
  const currentSession = this.sessions[this.sessions.length - 1];

  if (currentSession && !currentSession.loggedOutAt) {
    currentSession.loggedOutAt = new Date();
    currentSession.duration = Math.floor((currentSession.loggedOutAt - currentSession.loggedInAt) / 1000); // Duration in seconds
  }

  // Update online status
  this.isOnline = false;
  this.lastSeen = new Date();

  return this.save();
};

// Static method to get device activity for last 7 days
refreshTokenSchema.statics.getDeviceActivity = function (deviceId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return this.findOne({ deviceId })
    .select('deviceId deviceName isOnline lastSeen sessions')
    .lean();
};

// Static method to mark inactive devices as offline
refreshTokenSchema.statics.markInactiveDevicesOffline = async function () {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago

  const result = await this.updateMany(
    {
      lastSeen: { $lt: fifteenMinutesAgo },
      isOnline: true
    },
    {
      isOnline: false
    }
  );

  return result.modifiedCount;
};

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
