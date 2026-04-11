const RestaurantAdmin = require('../models/RestaurantAdmin');
const Superadmin = require('../models/Superadmin');

/**
 * Unified Activity Tracking Middleware
 * Consolidates global activity metrics (lastActivity, requestCount) 
 * and device-level session status (lastSeen, isOnline).
 * 
 * Must be used AFTER authentication (protect) middleware.
 */
const trackActivity = async (req, res, next) => {
  try {
    // skip tracking if no user is authenticated
    if (!req.userId) return next();

    const now = new Date();

    // 1. Determine user role from the authenticated request
    // We assume req.role is set by protect middleware, otherwise we fallback to checking models
    const role = req.user?.role || req.role || 'admin'; 

    if (role === 'superadmin') {
      // Superadmin logic: Only track device-level 'lastSeen'
      if (req.deviceId) {
        await Superadmin.updateOne(
          { _id: req.userId, 'refreshTokens.deviceId': req.deviceId },
          {
            $set: {
              'refreshTokens.$.lastSeen': now,
              'refreshTokens.$.isOnline': true
            }
          }
        ).catch(() => {});
      }
    } else {
      // RestaurantAdmin logic: Track global activity, request count, AND device status
      if (req.deviceId) {
        // Combined update for efficiency
        await RestaurantAdmin.updateOne(
          { _id: req.userId, 'refreshTokens.deviceId': req.deviceId },
          {
            $set: {
              lastActivity: now,
              'refreshTokens.$.lastSeen': now,
              'refreshTokens.$.isOnline': true
            },
            $inc: { requestCount: 1 }
          }
        ).catch(async (e) => {
            // Fallback: If device record not found, at least update global activity
            await RestaurantAdmin.findByIdAndUpdate(req.userId, {
              lastActivity: now,
              $inc: { requestCount: 1 }
            }).catch(() => {});
        });
      } else {
        // No deviceId available, just update global metrics
        await RestaurantAdmin.findByIdAndUpdate(req.userId, {
          lastActivity: now,
          $inc: { requestCount: 1 }
        }).catch(() => {});
      }
    }

    next();
  } catch (error) {
    // Never block requests due to tracking failures
    console.error('[ActivityTracker] Silent failure:', error.message);
    next();
  }
};

module.exports = { trackActivity };
