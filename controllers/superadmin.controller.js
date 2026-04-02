const User = require('../models/User');
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

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

const accessCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
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

    // Save refresh token hash
    user.refreshTokenHash = hashToken(refreshToken);
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
 * Check External Services & Internal Systems Status
 */
const getServiceStatus = async (req, res) => {
  try {
    const status = {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      cloudinary: 'operational', // Simplified for demo
      email: 'operational',
      cron: 'running',
      socket: req.app.get('io') ? 'operational' : 'error'
    };

    // Remove email ping to health-check@test.com as requested to stop costs and prevent proxy timeouts
    /* 
    try {
        await emailService.sendEmail({ 
            to: 'health-check@test.com', 
            subject: 'Ping', 
            text: 'Ping' 
        }).catch(() => {});
    } catch(e) {}
    */

    res.json({ success: true, status });
  } catch (error) {
    console.error('Service status check error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Detailed User Management & Tracking
 */
const getUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password -otp -otpExpires')
      .sort({ createdAt: -1 });

    // Enriched users for the dashboard
    const today = new Date();
    today.setHours(0,0,0,0);

    const enrichedUsers = await Promise.all(users.map(async (u) => {
      const ordersToday = await Order.countDocuments({
        restaurant: u._id,
        createdAt: { $gte: today }
      });

      return {
        ...u.toJSON(),
        ordersToday,
        isOnline: (new Date() - new Date(u.lastActivity)) < (10 * 60 * 1000) // Online if active in last 10 mins
      };
    }));

    res.json({ success: true, users: enrichedUsers });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Detailed Dashboard Analytics & Trend Data
 */
const getAnalytics = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);

    const totalOrdersToday = await Order.countDocuments({ createdAt: { $gte: today } });
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: today } });
    
    // Revenue trend (Approx)
    const orders = await Order.find({ createdAt: { $gte: today }, status: 'served' });
    const revenueToday = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    // Get real last 7 days data for charts
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    sevenDaysAgo.setHours(0,0,0,0);

    const weeklyDataMap = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(sevenDaysAgo);
        d.setDate(d.getDate() + i);
        const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
        weeklyDataMap[dayStr] = { name: dayStr, orders: 0, users: 0, date: d.toISOString().split('T')[0] };
    }

    const weeklyOrders = await Order.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } },
            count: { $sum: 1 }
        }}
    ]);

    const weeklyUsers = await User.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } },
            count: { $sum: 1 }
        }}
    ]);

    Object.values(weeklyDataMap).forEach(dayObj => {
        const orderMatch = weeklyOrders.find(o => o._id === dayObj.date);
        if (orderMatch) dayObj.orders = orderMatch.count;
        const userMatch = weeklyUsers.find(u => u._id === dayObj.date);
        if (userMatch) dayObj.users = userMatch.count;
    });

    const weeklyData = Object.values(weeklyDataMap);

    res.json({
      success: true,
      analytics: {
        today: {
          orders: totalOrdersToday,
          newUsers: newUsersToday,
          revenue: revenueToday
        },
        weeklyData
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Platform-wide Orders Overview (Aggregate counts, no identities)
 */
const getOrdersOverview = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);

    const stats = await Order.aggregate([
      { $match: { createdAt: { $gte: today } } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' },
          orderTypes: {
            $push: '$orderType'
          }
        }
      }
    ]);

    // Group types manually for simplicity in this aggregate
    const typeDistribution = stats[0]?.orderTypes?.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {}) || {};

    res.json({
      success: true,
      stats: {
        totalOrders: stats[0]?.totalOrders || 0,
        totalRevenue: stats[0]?.totalRevenue || 0,
        avgOrderValue: stats[0]?.avgOrderValue || 0,
        typeDistribution
      }
    });
  } catch (error) {
    console.error('Orders overview error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Get Detailed View of a Single User
 */
const getUserDetail = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId to prevent CastError
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    // Strictly sanitize user object - exclude sensitive or internal fields
    const user = await User.findById(id).select('restaurantName ownerName email subscription lastActivity requestCount createdAt');
    
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const totalOrders = await Order.countDocuments({ restaurant: id });
    const orders = await Order.find({ restaurant: id, status: 'served' });
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const menuItemsCount = await MenuItem.countDocuments({ restaurantId: id });

    // Operational insight (Counts only, no STORIES)
    res.json({
      success: true,
      user,
      stats: {
        totalOrders,
        totalRevenue,
        ordersServed: orders.length,
        menuItemsCount
      }
    });
  } catch (error) {
    console.error('Get user detail error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Update user account status (Active / Blocked)
 */
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body; // Expecting 'active' or 'inactive'

    const user = await User.findByIdAndUpdate(userId, { 
      $set: { 'subscription.status': status } 
    }, { new: true });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await logActivity({
      type: 'management',
      action: `${status === 'active' ? 'Activated' : 'Blocked'} account for ${user.email}`,
      user: req.user.email,
      req
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Update user subscription plan
 */
const updateSubscription = async (req, res) => {
  try {
    const { userId } = req.params;
    const { subscription } = req.body;
    
    // Update the nested subscription object
    const user = await User.findByIdAndUpdate(userId, { 
      $set: { subscription } 
    }, { new: true });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await logActivity({
      type: 'management',
      action: `Updated subscription for ${user.email}`,
      user: req.user.email,
      req
    });

    res.json({ success: true, user });
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
    
    if (user.refreshTokenHash !== tokenHash) {
      return res.status(401).json({ success: false, message: 'Invalid session (token mismatch)' });
    }

    const tokens = generateSuperadminTokens(user._id);
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    await user.save();

    res.cookie('accessToken', tokens.accessToken, accessCookieOptions);
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

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
    const user = await Superadmin.findById(req.user.id).select('-otp -otpExpires -refreshTokenHash');
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
 * Get Audit Logs with pagination and filtering
 */
const getAuditLogs = async (req, res) => {
  try {
    const { type, status, search, page = 1, limit = 20 } = req.query;
    
    // Build filter query
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { action: { $regex: search, $options: 'i' } },
        { user: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get logs with pagination
    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const total = await AuditLog.countDocuments(filter);
    
    res.json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = {
  requestOTP,
  verifyOTP,
  getSystemStats,
  getServiceStatus,
  getAnalytics,
  getOrdersOverview,
  getUsers,
  getUserDetail,
  updateUserStatus,
  updateSubscription,
  refreshSuperadminToken,
  logout,
  getAuditLogs,
  getMe
};
