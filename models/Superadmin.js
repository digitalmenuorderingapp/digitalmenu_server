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
  refreshTokenHash: {
    type: String,
    default: null
  },
  systemLogs: [systemLogSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Superadmin', superadminSchema);
