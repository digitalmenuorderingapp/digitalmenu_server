const RestaurantAdmin = require('../models/RestaurantAdmin');
const Superadmin = require('../models/Superadmin');

/**
 * Middleware to update last seen timestamp for authenticated users and their devices.
 */
const updateLastSeen = async (req, res, next) => {
  try {
    // Only update for authenticated requests with a device ID
    if (req.userId && req.deviceId) {
      const now = new Date();
      
      // Update for RestaurantAdmin first
      const restaurantResult = await RestaurantAdmin.updateOne(
        { _id: req.userId, 'refreshTokens.deviceId': req.deviceId },
        { 
          $set: { 
            'refreshTokens.$.lastSeen': now,
            'refreshTokens.$.isOnline': true
          }
        }
      );

      // If not a restaurant admin, try Superadmin
      if (restaurantResult.matchedCount === 0) {
        await Superadmin.updateOne(
          { _id: req.userId, 'refreshTokens.deviceId': req.deviceId },
          { 
            $set: { 
              'refreshTokens.$.lastSeen': now,
              'refreshTokens.$.isOnline': true
            }
          }
        );
      }
    }
    
    next();
  } catch (error) {
    // Don't block the request if update fails
    console.error('[LastSeen] Error updating activity:', error);
    next();
  }
};

module.exports = { updateLastSeen };
