const RestaurantAdmin = require('../models/RestaurantAdmin');

/**
 * Middleware to check if the restaurant's subscription is active and not expired.
 * Blocks order placement and acceptance if expired.
 */
const checkSubscription = async (req, res, next) => {
  try {
    // req.userId is usually set by authMiddleware
    const restaurantId = req.userId || req.body.restaurantId || req.params.restaurantId;

    if (!restaurantId) {
      console.warn(`[SubscriptionCheck] 400 - Missing restaurantId. req.userId: ${req.userId}, req.body.restaurantId: ${req.body.restaurantId}, req.params.restaurantId: ${req.params.restaurantId}, Path: ${req.originalUrl}`);
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID required for subscription check'
      });
    }

    const restaurant = await RestaurantAdmin.findById(restaurantId).select('subscription');
    
    if (!restaurant) {
      return res.status(404).json({ 
        success: false, 
        message: 'Restaurant not found' 
      });
    }

    const { subscription } = restaurant;
    const now = new Date();

    // 1. Check status
    if (subscription.status !== 'active') {
      console.warn(`[SubscriptionCheck] 403 - Inactive. Restaurant: ${restaurantId}`);
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'Your account is inactive. Please contact support.',
        subscription
      });
    }

    // 2. Check expiry (if not null)
    if (subscription.expiryDate && subscription.expiryDate < now) {
      console.warn(`[SubscriptionCheck] 403 - Expired. Restaurant: ${restaurantId}, Expiry: ${subscription.expiryDate}`);
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Your 3-month free trial or subscription has expired. Please subscribe for ₹2000/year to continue.',
        subscription
      });
    }

    // All good
    next();
  } catch (error) {
    console.error('Subscription Check Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = { checkSubscription };
