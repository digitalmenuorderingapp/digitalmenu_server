const jwt = require('jsonwebtoken');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const { hashToken } = require('../utils/token');

// Protect routes middleware
exports.protect = async (req, res, next) => {
  try {
    let token = req.cookies.accessToken;
    let refreshToken = req.cookies.refreshToken;

    if (!token) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[AUTH] 401 - Missing access token (Path: ${req.originalUrl})`);
      }
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
      const user = await RestaurantAdmin.findById(decoded.userId).select('subscription role refreshTokens');
      
      if (!user) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[AUTH] 401 - User not found in DB: ${decoded.userId}`);
        }
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Enforcement Logic for Restaurant Admins
      if (user.role === 'admin' || user.role === 'user') { // Checking both for legacy support
        const { status, type, expiryDate } = user.subscription;

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
          const hashed = hashToken(refreshToken);
          const tokenRecord = user.refreshTokens.find(t => t.tokenHash === hashed && !t.revokedAt);
          
          if (tokenRecord) {
            req.deviceId = tokenRecord.deviceId;
          }
        } catch (error) {
          console.error('❌ Error extracting device ID:', error);
        }
      }
      
      next();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[AUTH] 401 - Token Verification Failed: ${error.message} (Path: ${req.originalUrl})`);
      }
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token invalid'
      });
    }
  } catch (error) {
    next(error);
  }
};



