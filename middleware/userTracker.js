const RestaurantAdmin = require('../models/RestaurantAdmin');

/**
 * Middleware to track user (restaurant owner) activity
 * Should be placed AFTER the auth 'protect' middleware
 */
const trackUserActivity = async (req, res, next) => {
  if (req.userId) {
    try {
      // Async update - don't block the request
      RestaurantAdmin.findByIdAndUpdate(req.userId, {
        lastActivity: new Date(),
        $inc: { requestCount: 1 }
      }).catch(err => console.error('[UserTracker] Failed to update activity:', err));
    } catch (error) {
       // Silent catch
    }
  }
  next();
};

module.exports = { trackUserActivity };
