const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { hashToken } = require('../utils/token');

// Protect routes middleware
exports.protect = async (req, res, next) => {
  try {
    let token = req.cookies.accessToken;
    let refreshToken = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no access token'
      });
    }

    try {
      // Verify access token
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.userId = decoded.userId;

      // Fetch user to check status and subscription
      // We only select the necessary fields for performance
      const user = await User.findById(decoded.userId).select('subscription role');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User found in User collection'
        });
      }

      // Enforcement Logic for Restaurant Admins
      if (user.role === 'admin') {
        const { type, status, expiryDate } = user.subscription;

        // 1. Check for deactivation/blocking ('inactive')
        if (status === 'inactive') {
          return res.status(403).json({
            success: false,
            isRestricted: true,
            type: 'deactivated',
            message: 'Your account has been deactivated. Please contact support.'
          });
        }

        // 2. Check for expiration ('expired' or date-based)
        const isExpired = status === 'expired' || (type === 'paid' && expiryDate && new Date(expiryDate) < new Date());
        
        if (isExpired) {
          return res.status(403).json({
            success: false,
            isRestricted: true,
            type: 'expired',
            message: 'Your subscription has expired.'
          });
        }
      }
      
      // Try to get device ID from refresh token
      if (refreshToken) {
        try {
          const tokenRecord = await RefreshToken.findOne({
            tokenHash: hashToken(refreshToken),
            userId: decoded.userId,
            revokedAt: { $exists: false }
          });
          
          if (tokenRecord) {
            req.deviceId = tokenRecord.deviceId;
            console.log(`🔐 Auth - UserID: ${decoded.userId}, DeviceID: ${tokenRecord.deviceId}, Path: ${req.originalUrl}`);
          } else {
            console.log(`⚠️ No valid refresh token found for UserID: ${decoded.userId}`);
          }
        } catch (error) {
          console.error('❌ Error extracting device ID:', error);
        }
      }
      
      // Update last seen timestamp for authenticated users
      if (req.userId && req.deviceId) {
        try {
          console.log(`📱 Last Seen Update - UserID: ${req.userId}, DeviceID: ${req.deviceId}, Path: ${req.path}`);
          
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
        } catch (error) {
          console.error('❌ Error updating last seen:', error);
        }
      }
      
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token invalid'
      });
    }
  } catch (error) {
    next(error);
  }
};



