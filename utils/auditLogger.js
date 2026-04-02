const AuditLog = require('../models/AuditLog');

/**
 * Log a system activity
 * 
 * @param {string} type - 'auth' | 'user' | 'order' | 'system' | 'settings'
 * @param {string} action - 'Superadmin Login' | 'User Deactivated' | etc
 * @param {string} user - email or identifier
 * @param {string} status - 'success' | 'failed'
 * @param {object} details - Any additional data
 * @param {object} req - Optional express req object to extract IP
 */
const logActivity = async ({ type, action, user, status = 'success', details = {}, req = null }) => {
  try {
    const ip = req ? (req.ip || req.connection?.remoteAddress || 'unknown') : 'unknown';
    
    await AuditLog.create({
      type,
      action,
      user,
      ip,
      status,
      details
    });
  } catch (error) {
    // We don't want audit logging to crash the actual request
    console.error('❌ [Audit Logging Error]:', error);
  }
};

module.exports = { logActivity };
