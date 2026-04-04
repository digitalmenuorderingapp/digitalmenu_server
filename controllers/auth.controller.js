const jwt = require('jsonwebtoken');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const Order = require('../models/Order');
const DailyLedger = require('../models/DailyLedger');
const LedgerTransaction = require('../models/LedgerTransaction');
const MenuItem = require('../models/MenuItem');
const ExcelJS = require('exceljs');
const { hashToken } = require('../utils/token');
const emailService = require('../services/email.service');
const { registerOtpTemplate, resetPasswordOtpTemplate, deleteAccountOtpTemplate } = require('../templates/otpTemplates');
const { detailedReportEmailTemplate, accountDeletionExportTemplate } = require('../templates/detailedReportEmail');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../utils/cloudinary');
const { logActivity } = require('../utils/auditLogger');

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

// Register (Now sends OTP)
exports.register = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const existingUser = await RestaurantAdmin.findOne({ email });
    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(400).json({
          success: false,
          message: 'User already exists and is verified. Please login.'
        });
      }
      // If user exists but not verified, update password and send new OTP
      existingUser.password = password;
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      existingUser.verificationCode = otp;
      existingUser.verificationCodeExpires = Date.now() + 10 * 60 * 1000;
      await existingUser.save();

      await emailService.sendEmail({
        to: email,
        subject: 'DigitalMenu - Verification Code',
        html: registerOtpTemplate(otp)
      });

      return res.status(200).json({
        success: true,
        message: 'A new verification code has been sent to your email.'
      });
    }

    // Create user (unverified)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const user = await RestaurantAdmin.create({
      email,
      password,
      verificationCode: otp,
      verificationCodeExpires: Date.now() + 10 * 60 * 1000
    });

    // Send OTP
    await emailService.sendEmail({
      to: email,
      subject: 'DigitalMenu - Verification Code',
      html: registerOtpTemplate(otp)
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email with the OTP sent.'
    });
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

    user.isVerified = true;
    user.shortId = shortId;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;

    // Set trial initialization
    user.subscription = {
      type: 'trial',
      status: 'active',
      startDate: new Date(),
      expiryDate: expiryDate
    };

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
      sessions: [{ loggedInAt: new Date() }]
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
        description: user.description,
        logo: user.logo,
        shortId: user.shortId,
        subscription: user.subscription
      }
    });
  } catch (error) {
    next(error);
  }
};

// Login
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

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if verified
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Your email is not verified. Please verify it to login.',
        notVerified: true
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
      token.sessions.push({ loggedInAt: new Date() });

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
        sessions: [{ loggedInAt: new Date() }]
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
        description: user.description,
        logo: user.logo,
        shortId: user.shortId,
        subscription: user.subscription
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

    // Find admin user with this token
    const user = await RestaurantAdmin.findOne({
      _id: decoded.userId,
      'refreshTokens.tokenHash': hashed
    });

    if (!user) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[AUTH] Refresh - User or Token not found in DB`);
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid session'
      });
    }

    const tokenDoc = user.refreshTokens.find(t => t.tokenHash === hashed);

    if (!tokenDoc || tokenDoc.revokedAt) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[AUTH] Refresh - Token revoked in DB`);
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
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

    // Update existing token in-place (no new document created)
    tokenDoc.tokenHash = hashToken(tokens.refreshToken);
    tokenDoc.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    tokenDoc.revokedAt = undefined;
    tokenDoc.isOnline = true;
    tokenDoc.lastSeen = new Date();
    tokenDoc.ipAddress = req.ip || req.connection.remoteAddress;
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

    res.json({
      success: true,
      user
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
        ipAddress: d.ipAddress,
        issuedAt: d.issuedAt,
        expiresAt: d.expiresAt,
        isOnline: d.isOnline,
        lastSeen: d.lastSeen,
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

    await emailService.sendEmail({
      to: email,
      subject: 'DigitalMenu - Verification Code',
      html: registerOtpTemplate(otp)
    });

    res.json({ success: true, message: 'A new verification code has been sent.' });
  } catch (error) {
    next(error);
  }
};

// Update restaurant details
exports.updateRestaurant = async (req, res, next) => {
  try {
    const { restaurantName, ownerName, address, phone, description } = req.body;

    const user = await RestaurantAdmin.findByIdAndUpdate(
      req.userId,
      { restaurantName, ownerName, address, phone, description },
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

// Send delete account OTP
exports.sendDeleteAccountOtp = async (req, res, next) => {
  try {
    const userId = req.userId;
    const user = await RestaurantAdmin.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.deleteAccountOtp = otp;
    user.deleteAccountOtpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Try to send email, but don't fail if email service is down
    let emailSent = false;
    try {
      const emailInfo = await emailService.sendEmail({
        to: user.email,
        subject: 'DigitalMenu - Account Deletion Verification',
        html: deleteAccountOtpTemplate(otp)
      });
      emailSent = !!(emailInfo && emailInfo.messageId);
    } catch (emailError) {
      console.error('Email service error (delete account OTP):', emailError.message);
      // Continue - OTP is saved, user can request again or contact support
    }

    if (!emailSent) {
      return res.status(503).json({
        success: false,
        message: 'Email service temporarily unavailable. Please try again later or contact support.',
        emailSent: false
      });
    }

    res.json({
      success: true,
      message: 'Account deletion OTP sent to your email',
      emailSent: true
    });
  } catch (error) {
    console.error('Send delete account OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to send email. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
};

// Delete account with data export
exports.deleteAccount = async (req, res, next) => {
  try {
    const { otp } = req.body;
    const userId = req.userId;

    const user = await RestaurantAdmin.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.deleteAccountOtp !== otp || user.deleteAccountOtpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // Import ReportService for full export
    const ReportService = require('../services/report.service');
    const moment = require('moment-timezone');

    // Fetch all user data for full export
    const transactions = await LedgerTransaction.find({ restaurant: userId })
      .sort({ transactionDate: 1 })
      .lean();

    // Get unique order IDs from transactions
    const orderIds = [...new Set(transactions.map(t => t.orderId?.toString()).filter(Boolean))];

    // Fetch all related orders
    const orders = await Order.find({
      _id: { $in: orderIds }
    }).lean();

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
          // Continue with deletion even if image deletion fails
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

    // Determine date range for the report
    let dateRange;
    if (transactions.length > 0) {
      const firstTx = transactions[0];
      const lastTx = transactions[transactions.length - 1];
      dateRange = {
        from: moment(firstTx.transactionDate).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        to: moment(lastTx.transactionDate).tz('Asia/Kolkata').format('YYYY-MM-DD')
      };
    } else {
      dateRange = {
        from: moment().tz('Asia/Kolkata').format('YYYY-MM-DD'),
        to: moment().tz('Asia/Kolkata').format('YYYY-MM-DD')
      };
    }

    // Send unified report via helper (which now handles Menu Items automatically)
    const { sendDetailedReportEmail } = require('../utils/reportHelper');
    const oldestTx = transactions[0];
    const reportDateRange = {
      from: oldestTx ? moment(oldestTx.transactionDate).tz('Asia/Kolkata').format('YYYY-MM-DD') : moment().format('YYYY-MM-DD'),
      to: moment().tz('Asia/Kolkata').format('YYYY-MM-DD'),
      fromDate: oldestTx ? oldestTx.transactionDate : new Date('2000-01-01'),
      toDate: new Date()
    };
    
    await sendDetailedReportEmail({
      restaurant: user,
      emailType: 'DELETION',
      dateRange: reportDateRange,
      menuItems: menuItems, // Now handled universally by ReportService
      subject: 'DigitalMenu - Your Complete Data Export (Account Deletion)',
      customSummary: { totalMenuItems: menuItems.length }
    });

    // Delete all user data
    await Promise.all([
      Order.deleteMany({ restaurant: userId }),
      DailyLedger.deleteMany({ restaurant: userId }),
      LedgerTransaction.deleteMany({ restaurant: userId }),
      MenuItem.deleteMany({ restaurant: userId }),
      RestaurantAdmin.findByIdAndDelete(userId)
    ]);

    // Clear cookies
    res.clearCookie('accessToken', { ...cookieOptions, maxAge: 0 });
    res.clearCookie('refreshToken', { ...cookieOptions, maxAge: 0 });

    res.json({
      success: true,
      message: 'Your account has been deleted. A complete data export has been sent to your email.'
    });
  } catch (error) {
    next(error);
  }
};

exports.generateTokens = generateTokens;
exports.cookieOptions = cookieOptions;
exports.accessCookieOptions = accessCookieOptions;
