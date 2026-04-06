const RestaurantAdmin = require('../models/RestaurantAdmin');
const Superadmin = require('../models/Superadmin');
const Order = require('../models/Order');
const { generateOTP } = require('../utils/otp.util');
const emailService = require('../services/email.service');
const jwt = require('jsonwebtoken');
const { hashToken } = require('../utils/token');
const AuditLog = require('../models/AuditLog');
const { logActivity } = require('../utils/auditLogger');
const { getMetrics } = require('../middleware/systemMonitor');
const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');

// In-memory telemetry loops to replace dummy chart data
const systemMetricsHistory = [];
const platformThroughputHistory = [];
let lastLogCount = 0;

setInterval(async () => {
  try {
    const metrics = await getMetrics();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    systemMetricsHistory.push({
      time: timeStr,
      cpu: metrics.cpuUsage || 0,
      mem: metrics.memoryUsage ? (metrics.memoryUsage.heapUsed / 1024 / 1024) : 0
    });
    if (systemMetricsHistory.length > 60) systemMetricsHistory.shift();

    // Calculate a light throughput metric by checking DB action shifts
    const currentLogs = await AuditLog.countDocuments();
    const requestsSinceLast = Math.max(0, currentLogs - lastLogCount);
    if (lastLogCount === 0) { lastLogCount = currentLogs; } else { lastLogCount = currentLogs; }

    platformThroughputHistory.push({
      time: timeStr,
      requests: requestsSinceLast
    });
    if (platformThroughputHistory.length > 60) platformThroughputHistory.shift();

  } catch (e) {
    // Silent fail for background telemetry
  }
}, 5000);

// In-memory OTP storage for superadmin (sahin401099@gmail.com)
// Structured as { email: { otp, expires } }
const superadminOTPs = new Map();

// Token generation for superadmin
const generateSuperadminTokens = (id) => {
  const accessToken = jwt.sign(
    { id, role: 'superadmin' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m' }
  );

  const refreshToken = jwt.sign(
    { id, role: 'superadmin' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );

  return { accessToken, refreshToken };
};

const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

const accessCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 15 * 60 * 1000 // 15 minutes
};

/**
 * Request OTP for Superadmin login (Strict 5-min In-memory)
 */
const requestOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // Strict Hardcoded check for superadmin
    if (email !== 'sahin401099@gmail.com') {
      return res.status(403).json({ success: false, message: 'Unauthorized email' });
    }

    const otp = generateOTP();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // Strict 5 minutes

    // Store in memory
    superadminOTPs.set(email, { otp, expires });

    console.log(`🔐 [SUPERADMIN AUTH] OTP for ${email}: ${otp} (Expires in 5m)`);

    // Send email
    await emailService.sendEmail({
      to: email,
      subject: 'Superadmin Login OTP (DigitalMenu)',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; background: #f9fafb;">
          <div style="max-width: 600px; margin: auto; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);">
            <h2 style="color: #4F46E5; margin-bottom: 24px;">Superadmin Access Required</h2>
            <p>Your verification code for the Digital Menu central dashboard is:</p>
            <div style="background: #F3F4F6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; border-radius: 12px; margin: 30px 0; color: #111827; border: 1px solid #e5e7eb;">
              ${otp}
            </div>
            <p style="color: #6b7280; font-size: 14px;">This code will expire in <strong>5 minutes</strong> for security reasons.</p>
            <p style="margin-top: 40px; border-top: 1px solid #f3f4f6; pt-20; color: #9ca3af; font-size: 12px;">If you did not request this session, please contact system security immediately.</p>
          </div>
        </div>
      `
    });

    res.json({ success: true, message: 'OTP sent successfully (Expires in 5m)' });
  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Verify OTP and login
 */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const storedAuth = superadminOTPs.get(email);

    if (!storedAuth || storedAuth.otp !== otp || storedAuth.expires < new Date()) {
      await logActivity({
        type: 'auth',
        action: 'Failed Superadmin Login',
        user: email || 'unknown',
        status: 'failed',
        req
      });
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // Find or bootstrap superadmin in DB
    let user = await Superadmin.findOne({ email });
    if (!user) {
      user = await Superadmin.create({ email });
    }

    // Clear memory OTP
    superadminOTPs.delete(email);

    // Generate tokens
    const { accessToken, refreshToken } = generateSuperadminTokens(user._id);

    // Embedded refresh token for superadmin (multi-device support)
    const deviceId = req.body.deviceId || 'browser_session';
    const deviceName = req.body.deviceName || 'Superadmin Dashboard';

    // Clear old tokens for this device or append new one
    if (!user.refreshTokens) user.refreshTokens = [];

    // Find if device already exists
    const tokenIndex = user.refreshTokens.findIndex(t => t.deviceId === deviceId);
    const tokenData = {
      tokenHash: hashToken(refreshToken),
      deviceId,
      deviceName,
      ipAddress: req.ip || req.connection.remoteAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isOnline: true,
      lastSeen: new Date(),
      sessions: [{ loggedInAt: new Date() }]
    };

    if (tokenIndex !== -1) {
      user.refreshTokens[tokenIndex] = tokenData;
    } else {
      user.refreshTokens.push(tokenData);
    }

    await user.save();

    // Log successful login
    await logActivity({
      type: 'auth',
      action: 'Superadmin Login',
      user: email,
      req
    });

    // Set cookies
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: { id: user._id, email: user.email, role: 'superadmin' }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Get Real-time System Metrics
 */
const getSystemStats = async (req, res) => {
  try {
    const metrics = await getMetrics();
    const dbSize = await mongoose.connection.db.stats();

    // Active counts
    const activeSocketCount = req.app.get('io') ? req.app.get('io').engine.clientsCount : 0;

    res.json({
      success: true,
      metrics: {
        ...metrics,
        dbSize: dbSize.storageSize,
        dataSize: dbSize.dataSize,
        activeSockets: activeSocketCount,
        history: systemMetricsHistory,
        throughputData: platformThroughputHistory
      }
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Emit real-time service status to superadmin via socket.io
 * This is called periodically to keep superadmin dashboard updated
 */
const emitServiceStatus = async (io) => {
  if (!io) return;

  try {
    // Check MongoDB
    const mongoState = mongoose.connection.readyState;
    const mongoStatus = {
      0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting'
    }[mongoState] || 'unknown';

    let mongoStats = null;
    if (mongoState === 1) {
      try {
        const dbStats = await mongoose.connection.db.stats();
        mongoStats = {
          dataSize: (dbStats.dataSize / 1024 / 1024).toFixed(2) + ' MB',
          storageSize: (dbStats.storageSize / 1024 / 1024).toFixed(2) + ' MB',
          collections: dbStats.collections,
          documents: dbStats.objects
        };
      } catch (e) { }
    }

    // Check Cloudinary
    let cloudinaryStatus = 'error';
    let cloudinaryStorage = null;
    try {
      const cloudinary = require('cloudinary').v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
      });
      const usage = await cloudinary.api.usage();
      cloudinaryStatus = 'operational';
      cloudinaryStorage = {
        used: (usage.storage?.usage / 1024 / 1024 || 0).toFixed(2) + ' MB',
        limit: (usage.storage?.limit / 1024 / 1024 || 0).toFixed(2) + ' MB',
        bandwidth: (usage.bandwidth?.usage / 1024 / 1024 || 0).toFixed(2) + ' MB',
        requests: usage.requests?.usage || 0,
        percentage: usage.storage?.limit
          ? ((usage.storage.usage / usage.storage.limit) * 100).toFixed(1)
          : 0
      };
    } catch (e) {
      cloudinaryStatus = 'error';
    }

    const status = {
      mongodb: { status: mongoStatus, stats: mongoStats },
      cloudinary: { status: cloudinaryStatus, storage: cloudinaryStorage },
      email: 'operational',
      cron: 'running',
      socket: 'operational',
      timestamp: new Date().toISOString()
    };

    // Emit to superadmin room
    io.to('superadmin').emit('serviceStatusUpdate', status);
    // console.log('[Socket] Service status emitted to superadmin room');
  } catch (error) {
    console.error('Emit service status error:', error);
  }
};
const getRestaurants = async (req, res) => {
  try {
    const restaurants = await RestaurantAdmin.find({})
      .select('-password -otp -otpExpires')
      .sort({ createdAt: -1 });

    // Enriched restaurants for the dashboard
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const enrichedRestaurants = await Promise.all(restaurants.map(async (r) => {
      const ordersToday = await Order.countDocuments({
        restaurant: r._id,
        createdAt: { $gte: today }
      });

      return {
        ...r.toJSON(),
        ordersToday,
        isOnline: (new Date() - new Date(r.lastActivity)) < (10 * 60 * 1000) // Online if active in last 10 mins
      };
    }));

    res.json({ success: true, restaurants: enrichedRestaurants });
  } catch (error) {
    console.error('Get restaurants error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Get Detailed View of a Single Restaurant
 */
const getRestaurantDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId to prevent CastError
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }

    // Strictly sanitize restaurant object - exclude sensitive or internal fields
    const restaurant = await RestaurantAdmin.findById(id).select('restaurantName ownerName email subscription lastActivity requestCount createdAt');

    if (!restaurant) return res.status(404).json({ success: false, message: 'Restaurant not found' });

    const totalOrders = await Order.countDocuments({ restaurant: id });
    const orders = await Order.find({ restaurant: id, status: 'served' });
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const menuItemsCount = await MenuItem.countDocuments({ restaurantId: id });

    // Operational insight (Counts only, no STORIES)
    res.json({
      success: true,
      restaurant,
      stats: {
        totalOrders,
        totalRevenue,
        ordersServed: orders.length,
        menuItemsCount
      }
    });
  } catch (error) {
    console.error('Get restaurant detail error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Update user account status (Active / Blocked)
 */
const updateRestaurantStatus = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { status } = req.body; // Expecting 'active' or 'inactive'

    const restaurant = await RestaurantAdmin.findByIdAndUpdate(restaurantId, {
      $set: { 'subscription.status': status }
    }, { new: true });

    if (!restaurant) return res.status(404).json({ success: false, message: 'Restaurant not found' });

    await logActivity({
      type: 'management',
      action: `${status === 'active' ? 'Activated' : 'Blocked'} account for ${restaurant.email}`,
      user: req.user.email,
      req
    });

    res.json({ success: true, restaurant });
  } catch (error) {
    console.error('Update restaurant status error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Update user subscription plan
 */
const updateSubscription = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { subscription } = req.body;

    // Update the nested subscription object
    const restaurant = await RestaurantAdmin.findByIdAndUpdate(restaurantId, {
      $set: { subscription }
    }, { new: true });

    if (!restaurant) return res.status(404).json({ success: false, message: 'Restaurant not found' });

    await logActivity({
      type: 'management',
      action: `Updated subscription for ${restaurant.email}`,
      user: req.user.email,
      req
    });

    res.json({ success: true, restaurant });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Refresh Superadmin Token
 */
const refreshSuperadminToken = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'No refresh token provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (jwtError) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const user = await Superadmin.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Superadmin not found' });
    }

    const tokenHash = hashToken(refreshToken);
    const tokenDoc = user.refreshTokens.find(t => t.tokenHash === tokenHash);

    if (!tokenDoc || tokenDoc.revokedAt) {
      return res.status(401).json({ success: false, message: 'Invalid session (token mismatch or revoked)' });
    }

    const tokens = generateSuperadminTokens(user._id);

    // Update token in array
    tokenDoc.tokenHash = hashToken(tokens.refreshToken);
    tokenDoc.lastSeen = new Date();
    tokenDoc.ipAddress = req.ip || req.connection.remoteAddress;
    await user.save();

    res.cookie('accessToken', tokens.accessToken, accessCookieOptions);
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 [SUPERADMIN AUTH] Access Token Refreshed for Superadmin: ${user.email}`);
    }

    res.json({ success: true, accessToken: tokens.accessToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ success: false, message: 'Session expired' });
  }
};

/**
 * Get current superadmin profile
 */
const getMe = async (req, res) => {
  try {
    const user = await Superadmin.findById(req.user.id).select('-otp -otpExpires -refreshTokens');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const logout = async (req, res) => {
  res.clearCookie('accessToken', { ...accessCookieOptions, maxAge: 0 });
  res.clearCookie('refreshToken', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: 'Logged out' });
};

/**
 * Auto-login for superadmin (bypasses OTP - development/controlled environment only)
 */
const autoLogin = async (req, res) => {
  try {
    const hardcodedEmail = 'sahin401099@gmail.com';
    
    // Find or create superadmin
    let user = await Superadmin.findOne({ email: hardcodedEmail });
    if (!user) {
      user = await Superadmin.create({ email: hardcodedEmail });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateSuperadminTokens(user._id);

    // Device info
    const deviceId = req.body.deviceId || 'auto_session';
    const deviceName = req.body.deviceName || 'Auto Login';

    // Store refresh token
    if (!user.refreshTokens) user.refreshTokens = [];
    
    const tokenIndex = user.refreshTokens.findIndex(t => t.deviceId === deviceId);
    const tokenData = {
      tokenHash: hashToken(refreshToken),
      deviceId,
      deviceName,
      ipAddress: req.ip || req.connection.remoteAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isOnline: true,
      lastSeen: new Date(),
      sessions: [{ loggedInAt: new Date() }]
    };

    if (tokenIndex !== -1) {
      user.refreshTokens[tokenIndex] = tokenData;
    } else {
      user.refreshTokens.push(tokenData);
    }

    await user.save();

    // Log activity
    await logActivity({
      type: 'auth',
      action: 'Superadmin Auto-Login',
      user: hardcodedEmail,
      req
    });

    // Set cookies
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.json({
      success: true,
      message: 'Auto-login successful',
      accessToken,
      user: { id: user._id, email: user.email, role: 'superadmin' }
    });
  } catch (error) {
    console.error('Auto-login error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Get Cloudinary usage stats
 */
const getCloudinaryStats = async (req, res) => {
  try {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    // Get usage stats
    const usage = await cloudinary.api.usage();

    // Calculate storage metrics
    const storageUsed = usage.storage?.usage || 0;
    let storageLimit = usage.storage?.limit || 0;
    let bandwidthLimit = usage.bandwidth?.limit || 0;
    
    // Cloudinary Free plan defaults: 25GB storage, 25GB bandwidth per month
    const plan = usage.plan || 'Free';
    if (plan === 'Free') {
      if (storageLimit === 0) storageLimit = 25 * 1024 * 1024 * 1024; // 25 GB
      if (bandwidthLimit === 0) bandwidthLimit = 25 * 1024 * 1024 * 1024; // 25 GB per month
    }
    
    const percentage = storageLimit > 0 ? ((storageUsed / storageLimit) * 100).toFixed(1) : 0;

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json({
      success: true,
      cloudinary: {
        status: 'operational',
        used: storageUsed,
        limit: storageLimit,
        usedFormatted: (storageUsed / 1024 / 1024).toFixed(2) + ' MB',
        limitFormatted: (storageLimit / 1024 / 1024).toFixed(2) + ' MB',
        percentage: parseFloat(percentage),
        bandwidth: {
          used: usage.bandwidth?.usage || 0,
          limit: bandwidthLimit,
          formatted: (usage.bandwidth?.usage / 1024 / 1024 || 0).toFixed(2) + ' MB',
          limitFormatted: (bandwidthLimit / 1024 / 1024).toFixed(2) + ' MB',
          percentage: bandwidthLimit > 0 ? ((usage.bandwidth?.usage || 0) / bandwidthLimit * 100).toFixed(1) : 0
        },
        requests: usage.requests?.usage || 0,
        plan: plan
      }
    });
  } catch (error) {
    console.error('Cloudinary stats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Cloudinary stats'
    });
  }
};

/**
 * Get MongoDB usage stats
 */
const getMongoStats = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    
    // Check connection state
    const mongoState = mongoose.connection.readyState;
    const mongoStatus = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    }[mongoState] || 'unknown';

    if (mongoState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'MongoDB not connected',
        status: mongoStatus
      });
    }

    // Get database stats
    const dbStats = await mongoose.connection.db.stats();
    const adminStats = await mongoose.connection.db.admin().serverStatus();

    // Calculate storage metrics
    const dataSize = dbStats.dataSize || 0;
    const storageSize = dbStats.storageSize || 0;
    const indexSize = dbStats.indexSize || 0;
    const totalSize = storageSize + indexSize;

    // Helper to format bytes
    const formatBytes = (bytes) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // MongoDB Atlas Free Tier limits: 512 MB storage, 100 operations/sec
    const freeTierStorageLimit = 512 * 1024 * 1024; // 512 MB
    const storagePercentage = (totalSize / freeTierStorageLimit * 100).toFixed(1);

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json({
      success: true,
      mongodb: {
        status: 'connected',
        dataSize: dataSize,
        storageSize: storageSize,
        indexSize: indexSize,
        totalSize: totalSize,
        dataSizeFormatted: formatBytes(dataSize),
        storageSizeFormatted: formatBytes(storageSize),
        indexSizeFormatted: formatBytes(indexSize),
        totalSizeFormatted: formatBytes(totalSize),
        limit: freeTierStorageLimit,
        limitFormatted: formatBytes(freeTierStorageLimit),
        percentage: parseFloat(storagePercentage),
        opsPerSecondLimit: 100,
        collections: dbStats.collections,
        documents: dbStats.objects,
        indexes: dbStats.indexes,
        avgObjSize: dbStats.avgObjSize || 0,
        serverInfo: {
          version: adminStats.version,
          uptime: adminStats.uptime,
          connections: adminStats.connections
        }
      }
    });
  } catch (error) {
    console.error('MongoDB stats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch MongoDB stats'
    });
  }
};

/**
 * Manually trigger monthly reports for all or selected restaurants.
 * Only allowed between the 1st and 5th of the month.
 */
const triggerMonthlyReports = async (req, res) => {
  try {
    const { restaurantIds } = req.body; // Array of IDs or empty for all
    const { processMonthlyReports } = require('../utils/monthEndManager');

    // Safety check: Only between 1st and 5th
    const day = new Date().getDate();
    if (day > 5) {
      return res.status(400).json({
        success: false,
        message: 'Monthly reports can only be re-triggered between the 1st and 5th of the month before data is purged.'
      });
    }

    // Run in background to prevent timeout
    processMonthlyReports(restaurantIds).catch(err => 
      console.error('[Superadmin] Background report trigger failed:', err)
    );

    await logActivity({
      type: 'management',
      action: `Triggered manual monthly reports for ${restaurantIds?.length > 0 ? restaurantIds.length + ' selected' : 'all'} restaurants`,
      user: req.user.email,
      req
    });

    res.json({
      success: true,
      message: restaurantIds?.length > 0
        ? `Triggered reports for ${restaurantIds.length} selected restaurants.`
        : 'Triggered monthly reports for all restaurants.'
    });
  } catch (error) {
    console.error('Trigger monthly reports error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Get system audit logs with filtering and pagination
 */
const getAuditLogs = async (req, res) => {
  try {
    const { type, status, search, page = 1, limit = 50 } = req.query;
    
    const query = {};
    if (type && type !== 'all') query.type = type;
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { user: { $regex: search, $options: 'i' } },
        { action: { $regex: search, $options: 'i' } },
        { ip: { $regex: search, $options: 'i' } }
      ];
    }

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await AuditLog.countDocuments(query);

    res.json({
      success: true,
      logs,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalLogs: count
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = {
  requestOTP,
  verifyOTP,
  autoLogin,
  getSystemStats,
  emitServiceStatus,
  getRestaurants,
  getRestaurantDetail,
  updateRestaurantStatus,
  updateSubscription,
  refreshSuperadminToken,
  logout,
  getMe,
  getCloudinaryStats,
  getMongoStats,
  triggerMonthlyReports,
  getAuditLogs
};
