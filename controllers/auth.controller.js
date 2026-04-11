const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const Order = require('../models/Order');
const DailyLedger = require('../models/DailyLedger');
const MenuItem = require('../models/MenuItem');
const Table = require('../models/Table');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { hashToken } = require('../utils/token');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../utils/cloudinary');
const { logActivity } = require('../utils/auditLogger');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
);

// Generate tokens
const generateTokens = (userId, deviceId = null) => {
  const accessToken = jwt.sign(
    { userId, deviceId },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId, deviceId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );

  return { accessToken, refreshToken };
};

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

const accessCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 15 * 60 * 1000, // 15 minutes
  path: '/'
};

// ========== GOOGLE SIGN-IN ==========

// Verify Google token and login/signup user
// Verify Google token and login/signup user (GIS - Frontend flow)
exports.googleSignIn = async (req, res, next) => {
  try {
    const { idToken, deviceId, deviceName } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Google ID token is required' });
    }

    let payload;
    let googleRefreshToken = null;

    // Check if the provided 'idToken' is actually an authorization code (common with GIS Code Client)
    // Authorization codes are typically not JWTs (don't have 3 parts separated by dots)
    const isCode = idToken && idToken.split('.').length !== 3;

    if (isCode) {
      // Exchange authorization code for tokens
      // IMPORTANT: For Popup/GIS flow, redirect_uri must be 'postmessage'
      const { tokens } = await googleClient.getToken({
        code: idToken,
        redirect_uri: 'postmessage'
      });

      googleRefreshToken = tokens.refresh_token;

      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      // Verify Google ID token directly
      const ticket = await googleClient.verifyIdToken({
        idToken: idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    }

    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await RestaurantAdmin.findOne({ email });

    if (!user) {
      // Generate shortId
      const { generateShortId } = require('../utils/id.util');
      let shortId;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        shortId = generateShortId();
        const existing = await RestaurantAdmin.findOne({ shortId });
        if (!existing) isUnique = true;
        attempts++;
      }

      const trialDays = 90;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + trialDays);
      expiryDate.setHours(23, 59, 59, 999);

      const DeletedRestaurant = require('../models/DeletedRestaurant');
      const preservedRecord = await DeletedRestaurant.findOne({ email });

      let initialSubscription = {
        type: 'trial',
        status: 'active',
        startDate: new Date(),
        expiryDate: expiryDate
      };

      if (preservedRecord && preservedRecord.subscription) {
        initialSubscription = preservedRecord.subscription;
      }

      // Create new user with Google auth
      user = await RestaurantAdmin.create({
        email,
        googleId,
        ownerName: name || '',
        logo: picture || null,
        shortId: shortId,
        subscription: initialSubscription
      });
    } else if (!user.googleId) {
      // Link Google to existing local account
      user.googleId = googleId;
      await user.save();
    }

    // Always update Google Refresh Token if received (it's only sent on first consent or if prompt=consent is used)
    if (googleRefreshToken) {
      user.googleRefreshToken = googleRefreshToken;
      await user.save();
      console.log(`[AUTH] Updated Google Refresh Token for ${user.email}`);
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString(), deviceId);

    if (process.env.NODE_ENV === 'development') {
      console.log(`[AUTH] Generated internal tokens for ${user.email}. Device: ${deviceId}`);
    }

    // Hash and store refresh token with device info
    const tokenHash = hashToken(refreshToken);
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

    // Remove any existing tokens for this device
    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);

    // Add new refresh token
    user.refreshTokens.push({
      tokenHash,
      deviceId: deviceId || 'unknown',
      deviceName: deviceName || req.headers['user-agent'] || 'Unknown Device',
      ipAddress,
      lastSeen: new Date(),
      isOnline: true,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      loginMethod: 'google',
      sessions: [{
        loggedInAt: new Date(),
        loginMethod: 'google'
      }]
    });

    await user.save();

    // Set cookies
    if (isProduction) {
      console.log(`[AUTH] Production Environment - Setting Secure, SameSite=None cookies`);
    } else {
      console.warn(`[AUTH] Non-Production Environment - Cookies might fail in cross-site setup (SameSite=${cookieOptions.sameSite})`);
    }

    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // Log activity
    await logActivity({
      type: 'auth',
      user: user.email,
      action: 'GOOGLE_LOGIN',
      details: { deviceId, deviceName, ipAddress }
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        _id: user._id,
        email: user.email,
        restaurantName: user.restaurantName,
        ownerName: user.ownerName,
        logo: user.logo,
        role: user.role,
        subscription: user.subscription
      },
      loginMethod: 'google'
    });
  } catch (error) {
    console.error('Google Sign-In error:', error);
    res.status(401).json({
      success: false,
      message: 'Google authentication failed',
      error: error.message
    });
  }
};


// ========== LOCAL AUTH (Legacy Support) ==========

// Helper: Check and update subscription status
const checkSubscriptionStatus = async (user) => {
  if (!user.subscription) return { type: 'free', status: 'inactive', daysLeft: 0 };

  const { type, expiryDate, status } = user.subscription;

  // 1. Handle Lifetime Free (Legacy/Promotional)
  if (type === 'free') {
    return { ...user.subscription.toObject(), daysLeft: 9999, status: 'active' };
  }

  // 2. Handle Trial or Paid (requires expiryDate)
  if (!expiryDate) {
    return { ...user.subscription.toObject(), daysLeft: 0, status: 'inactive' };
  }

  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffTime = expiry.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let hasChanged = false;
  if (daysLeft <= 0 && user.subscription.status !== 'expired') {
    user.subscription.status = 'expired';
    hasChanged = true;
  } else if (daysLeft > 0 && user.subscription.status === 'expired') {
    user.subscription.status = 'active';
    hasChanged = true;
  }

  if (hasChanged) {
    await user.save();
  }

  return {
    ...user.subscription.toObject(),
    daysLeft: Math.max(0, daysLeft)
  };
};

// Set/Update password (only users originally from Google or via Google)
exports.setPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    const userId = req.userId;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const user = await RestaurantAdmin.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Set password and allow local login
    user.password = password;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// Login with password (for staff and users who set password after Google Sign-In)
exports.login = async (req, res, next) => {
  try {
    const { email, password, deviceId, deviceName } = req.body;

    // Check if user exists
    const user = await RestaurantAdmin.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user has password set (Google users without password need to set it first)
    if (!user.password) {
      return res.status(403).json({
        success: false,
        message: 'Please use Google Sign-In, or set a password in your restaurant settings first.',
        requirePassword: true
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Use provided deviceId (persistent from frontend)
    const deviceIdentifier = deviceId || 'unknown';

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id, deviceIdentifier);

    // Find if device already exists in the admin's refreshTokens
    const tokenIndex = user.refreshTokens.findIndex(t => t.deviceId === deviceIdentifier);

    if (tokenIndex !== -1) {
      // Update existing token and start new session
      const token = user.refreshTokens[tokenIndex];
      token.tokenHash = hashToken(refreshToken);
      token.deviceName = deviceName || req.headers['user-agent'] || 'Unknown Device';
      token.ipAddress = req.ip || req.connection.remoteAddress;
      token.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      token.revokedAt = undefined;
      token.isOnline = true;
      token.lastSeen = new Date();
      token.loginMethod = 'local';
      token.sessions.push({ loggedInAt: new Date(), loginMethod: 'local' });

      // Keep only last 7 days of sessions
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      token.sessions = token.sessions.filter(s => s.loggedInAt > sevenDaysAgo);
    } else {
      // Create new refresh token entry in the array
      user.refreshTokens.push({
        tokenHash: hashToken(refreshToken),
        deviceId: deviceIdentifier,
        deviceName: deviceName || req.headers['user-agent'] || 'Unknown Device',
        ipAddress: req.ip || req.connection.remoteAddress,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isOnline: true,
        lastSeen: new Date(),
        loginMethod: 'local',
        sessions: [{ loggedInAt: new Date(), loginMethod: 'local' }]
      });
    }

    await user.save();

    // Fire-and-forget logging (don't block response)
    logActivity({
      type: 'auth',
      action: 'User Login',
      user: email,
      req,
      details: {
        deviceId: deviceIdentifier,
        deviceName: deviceName || 'Unknown Device'
      }
    }).catch(err => console.error('[Auth] Failed to log activity:', err));

    // Set cookies
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.json({
      success: true,
      message: 'Login successful',
      loginMethod: 'local',
      user: {
        id: user._id,
        email: user.email,
        restaurantName: user.restaurantName,
        ownerName: user.ownerName,
        address: user.address,
        phone: user.phone,
        motto: user.motto,
        logo: user.logo,
        shortId: user.shortId,
        subscription: await checkSubscriptionStatus(user)
      }
    });
  } catch (error) {
    next(error);
  }
};
// Logout
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.cookies;

    // Find and update refresh token with session end
    if (refreshToken) {
      const hashed = hashToken(refreshToken);
      const user = await RestaurantAdmin.findOne({ 'refreshTokens.tokenHash': hashed });

      if (user) {
        const token = user.refreshTokens.find(t => t.tokenHash === hashed);
        if (token) {
          // End current session
          const currentSession = token.sessions[token.sessions.length - 1];
          if (currentSession && !currentSession.loggedOutAt) {
            currentSession.loggedOutAt = new Date();
            currentSession.duration = Math.floor((currentSession.loggedOutAt - currentSession.loggedInAt) / 1000);
          }
          token.isOnline = false;
          token.revokedAt = new Date();
          user.markModified('refreshTokens');
          await user.save();
        }
      }
    }

    // Clear cookies
    res.clearCookie('accessToken', { ...cookieOptions, maxAge: 0 });
    res.clearCookie('refreshToken', { ...cookieOptions, maxAge: 0 });

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    next(error);
  }
};

// Refresh token
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
      if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
        const cookieReport = req.headers.cookie ? 'present' : 'missing';
        console.warn(`[AUTH] Refresh - No refresh token cookie found. Cookie header: ${cookieReport}. Origin: ${req.headers.origin}`);
      } else {
        console.warn(`[AUTH] Refresh - No refresh token cookie found`);
      }
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const hashed = hashToken(refreshToken);

    // Find admin user - check both current hash and the previous hash (for grace period)
    const user = await RestaurantAdmin.findOne({
      _id: decoded.userId,
      $or: [
        { 'refreshTokens.tokenHash': hashed },
        { 'refreshTokens.prevTokenHash': hashed }
      ]
    });

    if (!user) {
      console.warn(`[AUTH] Refresh - User ${decoded.userId} or Token Hash ${hashed.substring(0, 10)}... not found in DB`);
      return res.status(401).json({
        success: false,
        message: 'Invalid session'
      });
    }

    // Find the specific token document
    const tokenDoc = user.refreshTokens.find(t => t.tokenHash === hashed || t.prevTokenHash === hashed);

    if (!tokenDoc || tokenDoc.revokedAt) {
      console.warn(`[AUTH] Refresh - Token revoked or missing for User: ${decoded.userId}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Grace Period Logic:
    // If the token matches prevTokenHash, check if it was rotated recently (< 60s)
    if (tokenDoc.prevTokenHash === hashed) {
      const RECENT_ROTATION_MS = 60 * 1000;
      const rotationAge = Date.now() - new Date(tokenDoc.rotatedAt).getTime();

      if (rotationAge > RECENT_ROTATION_MS) {
        console.warn(`[AUTH] Refresh - Expired grace period (old token) for User: ${decoded.userId}`);
        return res.status(401).json({
          success: false,
          message: 'Session expired'
        });
      }

      // If it's within 60s, we allow it to proceed and "re-issue" or just return same?
      // Traditionally we issue new ones but the key is NOT to throw 401.
      if (process.env.NODE_ENV === 'development') {
        console.log(`🕒 [AUTH] Refresh - Grace period used for User: ${decoded.userId}`);
      }
    }

    // Check if token is expired
    if (tokenDoc.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired'
      });
    }

    // Generate new tokens
    const tokens = generateTokens(decoded.userId, tokenDoc.deviceId);

    // Update token rotation info
    tokenDoc.prevTokenHash = hashed;
    tokenDoc.rotatedAt = new Date();
    tokenDoc.tokenHash = hashToken(tokens.refreshToken);
    tokenDoc.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    tokenDoc.revokedAt = undefined;
    tokenDoc.isOnline = true;
    tokenDoc.lastSeen = new Date();
    tokenDoc.ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    tokenDoc.userAgent = req.headers['user-agent'];
    await user.save();

    // Set new cookies
    res.cookie('accessToken', tokens.accessToken, accessCookieOptions);
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 [AUTH] Access Token Refreshed for User: ${decoded.userId}`);
    }

    res.json({
      success: true,
      message: 'Token refreshed',
      loginMethod: req.loginMethod || tokenDoc.loginMethod
    });
  } catch (error) {
    console.error(`[AUTH] Refresh - Error: ${error.message}`);
    res.clearCookie('accessToken', { ...cookieOptions, maxAge: 0 });
    res.clearCookie('refreshToken', { ...cookieOptions, maxAge: 0 });

    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};


// Get current user
exports.getMe = async (req, res, next) => {
  try {
    const user = await RestaurantAdmin.findById(req.userId).select('-password -refreshTokens');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const subData = await checkSubscriptionStatus(user);

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        subscription: subData
      },
      loginMethod: req.loginMethod
    });
  } catch (error) {
    next(error);
  }
};

// Get subscription status only
exports.getSubscription = async (req, res, next) => {
  try {
    const user = await RestaurantAdmin.findById(req.userId).select('subscription status');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const subData = await checkSubscriptionStatus(user);

    res.json({
      success: true,
      subscription: subData
    });
  } catch (error) {
    next(error);
  }
};

// List active devices
exports.listActiveDevices = async (req, res, next) => {
  try {
    const user = await RestaurantAdmin.findById(req.userId).select('refreshTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const devices = user.refreshTokens.sort((a, b) => b.lastSeen - a.lastSeen);

    res.json({
      success: true,
      count: devices.length,
      data: devices.map(d => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        userAgent: d.deviceName, // Map deviceName to userAgent for frontend compatibility
        ipAddress: d.ipAddress,
        issuedAt: d.issuedAt,
        expiresAt: d.expiresAt,
        isOnline: d.isOnline,
        lastSeen: d.lastSeen,
        loginMethod: d.loginMethod || 'local',
        revokedAt: d.revokedAt
      }))
    });
  } catch (error) {
    next(error);
  }
};

// Logout specific device
exports.logoutDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.body;
    const user = await RestaurantAdmin.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const token = user.refreshTokens.find(t => t.deviceId === deviceId);
    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    token.revokedAt = new Date();
    token.isOnline = false;

    // End current session if active
    const currentSession = token.sessions[token.sessions.length - 1];
    if (currentSession && !currentSession.loggedOutAt) {
      currentSession.loggedOutAt = new Date();
      currentSession.duration = Math.floor((currentSession.loggedOutAt - currentSession.loggedInAt) / 1000);
    }

    user.markModified('refreshTokens');
    await user.save();

    res.json({
      success: true,
      message: 'Device logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Update restaurant details
exports.updateRestaurant = async (req, res, next) => {
  try {
    const { restaurantName, ownerName, address, phone, motto } = req.body;

    const user = await RestaurantAdmin.findByIdAndUpdate(
      req.userId,
      { restaurantName, ownerName, address, phone, motto },
      { new: true, runValidators: true }
    ).select('-password -refreshTokens');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Restaurant details updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

// Upload restaurant logo
exports.uploadLogo = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const user = await RestaurantAdmin.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Delete old logo if exists
    if (user.logo) {
      const publicId = extractPublicId(user.logo);
      if (publicId) {
        await deleteFromCloudinary(publicId);
      }
    }

    // Upload new logo
    const result = await uploadToCloudinary(req.file.buffer, 'digitalmenu/logos');
    user.logo = result.secure_url;
    await user.save();

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      logo: user.logo
    });
  } catch (error) {
    next(error);
  }
};

// Remove restaurant logo
exports.removeLogo = async (req, res, next) => {
  try {
    const user = await RestaurantAdmin.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.logo) {
      const publicId = extractPublicId(user.logo);
      if (publicId) {
        await deleteFromCloudinary(publicId);
      }
      user.logo = null;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Logo removed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Delete account with data export
exports.deleteAccount = async (req, res, next) => {
  try {
    const { captcha, reason } = req.body;
    const userId = req.userId;

    const user = await RestaurantAdmin.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (captcha !== 'DELETE') {
      return res.status(400).json({ success: false, message: 'Invalid confirmation phrase' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Deletion reason is required' });
    }

    // Import ReportService for full export
    // Get menu items for additional sheet and image deletion
    const menuItems = await MenuItem.find({ restaurant: userId }).lean();

    // Delete menu item images from Cloudinary
    const { deleteFromCloudinary, extractPublicId } = require('../utils/cloudinary');
    const imageDeletePromises = menuItems
      .filter(item => item.image && item.image.includes('cloudinary.com'))
      .map(async (item) => {
        try {
          const publicId = extractPublicId(item.image);
          if (publicId) {
            await deleteFromCloudinary(publicId);
            console.log(`[DeleteAccount] Deleted Cloudinary image: ${publicId}`);
          }
        } catch (imgError) {
          console.error(`[DeleteAccount] Failed to delete image for item ${item._id}:`, imgError.message);
        }
      });

    // Delete restaurant logo from Cloudinary if exists
    if (user.logo && user.logo.includes('cloudinary.com')) {
      try {
        const logoPublicId = extractPublicId(user.logo);
        if (logoPublicId) {
          await deleteFromCloudinary(logoPublicId);
          console.log(`[DeleteAccount] Deleted Restaurant Logo: ${logoPublicId}`);
        }
      } catch (logoError) {
        console.error(`[DeleteAccount] Failed to delete restaurant logo:`, logoError.message);
      }
    }

    await Promise.allSettled(imageDeletePromises);

    // Store original subscription and email in DeletedRestaurant for potential future recovery
    const DeletedRestaurant = require('../models/DeletedRestaurant');
    await DeletedRestaurant.findOneAndUpdate(
      { email: user.email },
      {
        email: user.email,
        subscription: user.subscription,
        deletionReason: reason
      },
      { upsert: true, new: true }
    );

    // Delete all user data
    await Promise.all([
      Order.deleteMany({ restaurant: userId }),
      DailyLedger.deleteMany({ restaurant: userId }),
      MenuItem.deleteMany({ restaurant: userId }),
      Table.deleteMany({ restaurant: userId }),
      RestaurantAdmin.findByIdAndDelete(userId)
    ]);

    // Clear cookies
    res.clearCookie('accessToken', { ...cookieOptions, maxAge: 0 });
    res.clearCookie('refreshToken', { ...cookieOptions, maxAge: 0 });

    res.json({
      success: true,
      message: 'Your account and all related data have been permanently deleted.'
    });
  } catch (error) {
    next(error);
  }
};

exports.generateTokens = generateTokens;
exports.cookieOptions = cookieOptions;
exports.accessCookieOptions = accessCookieOptions;
