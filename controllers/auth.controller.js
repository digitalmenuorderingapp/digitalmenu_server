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
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );

  return { accessToken, refreshToken };
};

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: isProduction, // Only force secure in production
  sameSite: isProduction ? 'none' : 'lax', // 'none' requires HTTPS, 'lax' is better for local dev
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

const accessCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 15 * 60 * 1000 // 15 minutes
};

// ========== GOOGLE SIGN-IN ==========

// Verify Google token and login/signup user
exports.googleSignIn = async (req, res, next) => {
  try {
    const { access_token, deviceId, deviceName } = req.body;

    if (!access_token) {
      return res.status(400).json({ success: false, message: 'Google access token is required' });
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: access_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
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

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    // Hash and store refresh token with device info
    const tokenHash = hashToken(refreshToken);
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Remove any existing tokens for this device
    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);

    // Add new refresh token
    user.refreshTokens.push({
      tokenHash,
      deviceId: deviceId || 'unknown',
      deviceName: deviceName || 'Unknown Device',
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
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // Log activity
    await logActivity({
      userId: user._id,
      restaurantId: user._id,
      action: 'GOOGLE_LOGIN',
      entityType: 'USER',
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
      }
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

// ========== GOOGLE OAUTH REDIRECT FLOW ==========

// Generate Google OAuth URL and redirect
exports.googleAuth = async (req, res) => {
  try {
    const { deviceId, deviceName } = req.query;
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`;
    
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ];
    
    // Pass deviceInfo smoothly through Google using State 
    const stateObj = { 
      deviceId: deviceId || 'unknown', 
      deviceName: deviceName || req.headers['user-agent'] || 'Unknown Browser' 
    };
    const stateParam = Buffer.from(JSON.stringify(stateObj)).toString('base64');
    
    const authUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      redirect_uri: redirectUri,
      state: stateParam
    });
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('Google Auth URL generation error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth?mode=register&error=google_auth_failed`);
  }
};

// Handle Google OAuth callback
exports.googleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/auth?mode=register&error=no_code`);
    }
    
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`;
    
    // Exchange code for tokens
    const { tokens } = await googleClient.getToken({
      code,
      redirect_uri: redirectUri
    });
    
    // Verify ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;
    
    // Get device info from query params (passed through state) or use defaults
    let deviceId = 'unknown';
    let deviceName = 'Unknown Browser';
    
    if (req.query.state) {
      try {
        const stateObj = JSON.parse(Buffer.from(req.query.state, 'base64').toString('ascii'));
        if (stateObj.deviceId) deviceId = stateObj.deviceId;
        if (stateObj.deviceName) deviceName = stateObj.deviceName;
      } catch (e) {
        deviceName = req.headers['user-agent'] || 'Unknown Browser';
      }
    } else {
      deviceName = req.headers['user-agent'] || 'Unknown Browser';
    }
    
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
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString());
    
    // Hash and store refresh token
    const tokenHash = hashToken(refreshToken);
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Remove any existing tokens for this device
    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);
    
    // Add new refresh token
    user.refreshTokens.push({
      tokenHash,
      deviceId: deviceId || 'unknown',
      deviceName: deviceName || 'Unknown Device',
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
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);
    
    // Log activity
    await logActivity({
      userId: user._id,
      restaurantId: user._id,
      action: 'GOOGLE_LOGIN',
      entityType: 'USER',
      details: { deviceId, deviceName, ipAddress }
    });
    
    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/admin/dashboard`);
    
  } catch (error) {
    console.error('Google Callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth?mode=register&error=google_callback_failed`);
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

// Verify Registration OTP
exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp, deviceId, deviceName } = req.body;

    const user = await RestaurantAdmin.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'User already verified' });
    }

    if (user.verificationCode !== otp || user.verificationCodeExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    // Mark as verified & set up 3-month free trial
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

    user.isVerified = true;
    user.shortId = shortId;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;

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

    // Set trial initialization
    user.subscription = initialSubscription;

    await user.save();

    // Now log them in (Generate tokens)
    const { accessToken, refreshToken } = generateTokens(user._id);

    // Initialize refreshTokens array if it doesn't exist
    if (!user.refreshTokens) user.refreshTokens = [];

    // Create session embedded in RestaurantAdmin
    const tokenData = {
      tokenHash: hashToken(refreshToken),
      deviceId: deviceId || 'unknown',
      deviceName: deviceName || 'Unknown Device',
      ipAddress: req.ip || req.connection.remoteAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isOnline: true,
      lastSeen: new Date(),
      loginMethod: 'local',
      sessions: [{ loggedInAt: new Date(), loginMethod: 'local' }]
    };

    user.refreshTokens.push(tokenData);
    await user.save();

    // Log successful registration/verification
    await logActivity({
      type: 'user',
      action: 'Account Verified & Logged In',
      user: user.email,
      req
    });

    // Set cookies
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Email verified and login successful',
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

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);

    // Use provided deviceId (persistent from frontend)
    const deviceIdentifier = deviceId || 'unknown';

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
      if (process.env.NODE_ENV === 'development') {
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
    const tokens = generateTokens(decoded.userId);

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
      message: 'Token refreshed'
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
      }
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

// Forgot Password - Send OTP
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await RestaurantAdmin.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordOtp = otp;
    user.resetPasswordOtpExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    await emailService.sendEmail({
      to: email,
      subject: 'DigitalMenu - Password Reset OTP',
      html: resetPasswordOtpTemplate(otp)
    });

    res.json({ success: true, message: 'Password reset OTP sent to your email' });
  } catch (error) {
    next(error);
  }
};

// Reset Password with OTP
exports.resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await RestaurantAdmin.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.resetPasswordOtp !== otp || user.resetPasswordOtpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    user.password = newPassword;
    user.resetPasswordOtp = undefined;
    user.resetPasswordOtpExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful. You can now login.' });
  } catch (error) {
    next(error);
  }
};

// Resend Verification OTP
exports.resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await RestaurantAdmin.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'User already verified' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.verificationCode = otp;
    user.verificationCodeExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    // Try to send email
    let emailSent = false;
    let emailError = null;
    try {
      const result = await emailService.sendEmail({
        to: email,
        subject: 'DigitalMenu - Verification Code',
        html: registerOtpTemplate(otp)
      });
      emailSent = result && (result.sent || result.messageId || result.id);
      if (!emailSent) {
        emailError = result?.error || 'Email service returned no confirmation';
      }
    } catch (err) {
      emailError = err.message;
      console.error('[ResendOTP] Email send failed:', err.message);
    }

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: `Failed to send verification email: ${emailError}. Please try again or contact support.`,
        emailError: emailError
      });
    }

    res.json({ success: true, message: 'A new verification code has been sent.' });
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
