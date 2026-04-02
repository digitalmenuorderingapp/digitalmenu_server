const RefreshToken = require('../models/RefreshToken');
const User = require('../models/User');

// Get all devices for the authenticated user with session history
exports.getDevices = async (req, res, next) => {
  try {
    const devices = await RefreshToken.find({ userId: req.userId })
      .select('deviceId deviceName isOnline lastSeen sessions ipAddress userAgent')
      .sort({ lastSeen: -1 });

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
        userAgent: device.userAgent,
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
    
    const device = await RefreshToken.findOne({ 
      userId: req.userId, 
      deviceId 
    }).select('deviceId deviceName isOnline lastSeen sessions ipAddress userAgent');

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Sort sessions by login time (most recent first)
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
        userAgent: device.userAgent,
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
    
    const result = await RefreshToken.updateMany(
      { userId: req.userId, deviceId },
      { 
        revokedAt: new Date(),
        isOnline: false
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    res.json({
      success: true,
      message: 'Device revoked successfully'
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
