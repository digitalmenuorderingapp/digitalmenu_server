const RefreshToken = require('../models/RefreshToken');

// Middleware to update last seen timestamp for authenticated users
const updateLastSeen = async (req, res, next) => {
  console.log(`📱 Last Seen Middleware - Path: ${req.path}, UserID: ${req.userId || 'undefined'}, DeviceID: ${req.deviceId || 'undefined'}`);
  
  try {
    // Only update for authenticated requests
    if (req.userId && req.deviceId) {
      console.log(`📱 Last Seen Update - UserID: ${req.userId}, DeviceID: ${req.deviceId}, Path: ${req.path}`);
      
      // Update last seen timestamp for the device
      const result = await RefreshToken.updateOne(
        { 
          userId: req.userId, 
          deviceId: req.deviceId 
        },
        { 
          lastSeen: new Date(),
          isOnline: true
        },
        { upsert: false }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`✅ Last seen updated for device: ${req.deviceId}`);
      } else {
        console.log(`⚠️ No device found to update: ${req.deviceId}`);
      }
    } else {
      console.log(`📱 Skipping last seen update - Missing credentials`);
    }
    
    next();
  } catch (error) {
    // Don't block the request if last seen update fails
    console.error('❌ Error updating last seen:', error);
    next();
  }
};

module.exports = { updateLastSeen };
