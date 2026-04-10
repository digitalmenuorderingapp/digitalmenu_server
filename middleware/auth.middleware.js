const jwt = require('jsonwebtoken');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const { hashToken } = require('../utils/token');

// Protect routes middleware
exports.protect = async (req, res, next) => {
  try {
    let token = req.cookies.accessToken;
    let refreshToken = req.cookies.refreshToken;

    if (!token) {
      // Diagnostic log for all environments
      const cookieNames = req.cookies ? Object.keys(req.cookies).join(', ') : 'none';
      console.warn(`[AUTH] 401 - Missing access token (Path: ${req.originalUrl}, HasRefreshToken: ${!!refreshToken}, CookiesFound: [${cookieNames}], Secure: ${req.secure}, Protocol: ${req.protocol}, IP: ${req.ip})`);
      
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
      // We need refreshTokens to check for revocation
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

      // 1. Determine Device ID
      let deviceId = decoded.deviceId;
      let tokenRecord = null;

      if (deviceId) {
        // Find the record for this specific device
        tokenRecord = user.refreshTokens.find(t => t.deviceId === deviceId);
      } else if (refreshToken) {
        // Fallback for legacy tokens: check by refresh token hash
        const hashed = hashToken(refreshToken);
        tokenRecord = user.refreshTokens.find(t => t.tokenHash === hashed);
      }

      // 2. STRICTOR CHECK: Revocation
      // If we found a record but it's revoked, REJECT immediately.
      // This is the core of the "Instant Logout" fix.
      if (tokenRecord && tokenRecord.revokedAt) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[AUTH] 401 - Device Revoked: ${tokenRecord.deviceId}`);
        }
        return res.status(401).json({
          success: false,
          message: 'Session revoked. Please login again.',
          isRevoked: true
        });
      }

      // Set device ID and login method for downstream use (like lastSeen and getMe)
      if (tokenRecord) {
        req.deviceId = tokenRecord.deviceId;
        req.loginMethod = tokenRecord.loginMethod || 'password';
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
      next();
    } catch (error) {
      console.error(`[AUTH] 401 - Token Verification Failed: ${error.message} (Path: ${req.originalUrl})`);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token invalid'
      });
    }
  } catch (error) {
    next(error);
  }
};



