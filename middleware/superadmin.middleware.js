const jwt = require('jsonwebtoken');
const Superadmin = require('../models/Superadmin');

/**
 * Superadmin authorization middleware
 */
const superadminProtect = async (req, res, next) => {
  try {
    let token = req.cookies.accessToken || req.cookies.token; // Handle both during transition if needed, but prefer accessToken

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      
      // Explicitly check role from token
      if (decoded.role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized as superadmin (role mismatch)'
        });
      }

      const user = await Superadmin.findById(decoded.id);
      
      if (!user) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized as superadmin (account not found)'
        });
      }

      req.user = user;
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

module.exports = { superadminProtect };
