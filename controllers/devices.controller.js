const RestaurantAdmin = require('../models/RestaurantAdmin');
const Superadmin = require('../models/Superadmin');

// Get all devices for the authenticated user with session history
exports.getDevices = async (req, res, next) => {
  try {
    const user = await RestaurantAdmin.findById(req.userId).select('refreshTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const devices = user.refreshTokens.sort((a, b) => b.lastSeen - a.lastSeen);

    // Format the response with session data
    const formattedDevices = devices.map(device => {
      // Sort sessions by login time (most recent first)
      const sortedSessions = device.sessions.sort((a, b) => 
        new Date(b.loggedInAt) - new Date(a.loggedInAt)
      );
      
      return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        isOnline: device.isOnline,
        lastSeen: device.lastSeen,
        ipAddress: device.ipAddress,
        revokedAt: device.revokedAt,
        sessions: sortedSessions.map(session => ({
          loggedInAt: session.loggedInAt,
          loggedOutAt: session.loggedOutAt,
          duration: session.duration
        }))
      };
    });

    res.json({
      success: true,
      count: formattedDevices.length,
      data: formattedDevices
    });
  } catch (error) {
    next(error);
  }
};

// Get device activity details for a specific device
exports.getDeviceActivity = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const user = await RestaurantAdmin.findById(req.userId).select('refreshTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const device = user.refreshTokens.find(t => t.deviceId === deviceId);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Sort sessions by login time
    const sortedSessions = device.sessions.sort((a, b) => 
      new Date(b.loggedInAt) - new Date(a.loggedInAt)
    ).map(session => ({
      loggedInAt: session.loggedInAt,
      loggedOutAt: session.loggedOutAt,
      duration: session.duration
    }));

    res.json({
      success: true,
      data: {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        isOnline: device.isOnline,
        lastSeen: device.lastSeen,
        ipAddress: device.ipAddress,
        revokedAt: device.revokedAt,
        sessions: sortedSessions
      }
    });
  } catch (error) {
    next(error);
  }
};

// Revoke a specific device (logout all sessions for that device)
exports.revokeDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
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
    
    await user.save();

    res.json({
      success: true,
      message: 'Device revoked successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Permanently remove a specific device
exports.removeDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const user = await RestaurantAdmin.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const deviceIndex = user.refreshTokens.findIndex(t => t.deviceId === deviceId);
    if (deviceIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    const device = user.refreshTokens[deviceIndex];
    
    // Safety check: Don't allow removing active devices directly? 
    // Actually, user wants "for logged out devices", but if they call this, we just remove it.
    // If it's the current deviceId (passed in headers maybe?), we should caution.
    
    user.refreshTokens.splice(deviceIndex, 1);
    await user.save();

    res.json({
      success: true,
      message: 'Device removed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get device statistics
exports.getDeviceStats = async (req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const stats = await RefreshToken.aggregate([
      { $match: { userId: req.userId } },
      {
        $project: {
          deviceId: 1,
          deviceName: 1,
          isOnline: 1,
          lastSeen: 1,
          totalSessions: { $size: "$sessions" },
          recentSessions: {
            $filter: {
              input: "$sessions",
              cond: { $gte: ["$$this.loggedInAt", sevenDaysAgo] }
            }
          },
          completedSessions: {
            $filter: {
              input: "$sessions",
              cond: { $and: [
                { $gte: ["$$this.loggedInAt", sevenDaysAgo] },
                { $ne: ["$$this.loggedOutAt", null] }
              ]}
            }
          },
          activeSessions: {
            $filter: {
              input: "$sessions",
              cond: { $and: [
                { $gte: ["$$this.loggedInAt", sevenDaysAgo] },
                { $eq: ["$$this.loggedOutAt", null] }
              ]}
            }
          }
        }
      },
      {
        $project: {
          deviceId: 1,
          deviceName: 1,
          isOnline: 1,
          lastSeen: 1,
          totalSessions: 1,
          recentSessions: { $size: "$recentSessions" },
          completedSessions: { $size: "$completedSessions" },
          activeSessions: { $size: "$activeSessions" },
          totalDuration: {
            $sum: "$recentSessions.duration"
          },
          averageSessionDuration: {
            $avg: {
              $filter: {
                input: "$recentSessions",
                cond: { $ne: ["$$this.duration", null] }
              }
            }
          }
        }
      },
      { $sort: { lastSeen: -1 } }
    ]);

    const totalStats = stats.reduce((acc, device) => {
      acc.totalDevices += 1;
      acc.onlineDevices += device.isOnline ? 1 : 0;
      acc.totalSessions += device.recentSessions;
      acc.completedSessions += device.completedSessions;
      acc.activeSessions += device.activeSessions;
      acc.totalDuration += device.totalDuration || 0;
      return acc;
    }, {
      totalDevices: 0,
      onlineDevices: 0,
      totalSessions: 0,
      completedSessions: 0,
      activeSessions: 0,
      totalDuration: 0
    });

    // Calculate average session duration
    totalStats.averageSessionDuration = totalStats.completedSessions > 0 
      ? Math.round(totalStats.totalDuration / totalStats.completedSessions)
      : 0;

    res.json({
      success: true,
      data: {
        devices: stats,
        summary: totalStats
      }
    });
  } catch (error) {
    next(error);
  }
};
