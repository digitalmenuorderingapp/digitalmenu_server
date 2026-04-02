const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['auth', 'user', 'order', 'system', 'settings'],
    required: true
  },
  action: {
    type: String,
    required: true
  },
  user: {
    type: String, // Email or standard identifier
    required: true
  },
  ip: {
    type: String,
    default: 'unknown'
  },
  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false // We use createdAt manually as the event time
});

// Indexing for faster searching and filtering
auditLogSchema.index({ type: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
