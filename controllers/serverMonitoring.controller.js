const serverMonitor = require('../services/serverMonitor.service');
const DailyServerUsage = require('../models/DailyServerUsage');

// Middleware to track requests
exports.trackRequest = (req, res, next) => {
  serverMonitor.trackRequest(req, res, next);
};

// Get current real-time server stats
exports.getCurrentStats = async (req, res) => {
  try {
    const stats = serverMonitor.getCurrentStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get daily server usage data
exports.getDailyUsage = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const usage = await DailyServerUsage.getUsageTrend(parseInt(days));
    
    res.json({
      success: true,
      data: usage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get peak usage times
exports.getPeakUsageTimes = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const peakTimes = await DailyServerUsage.getPeakUsageTimes(parseInt(days));
    
    res.json({
      success: true,
      data: peakTimes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get endpoint performance data
exports.getEndpointPerformance = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const performance = await DailyServerUsage.getEndpointPerformance(parseInt(days));
    
    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get detailed usage analysis
exports.getUsageAnalysis = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchQuery = {};
    if (startDate || endDate) {
      matchQuery.date = {};
      if (startDate) matchQuery.date.$gte = new Date(startDate);
      if (endDate) matchQuery.date.$lte = new Date(endDate);
    }
    
    const analysis = await DailyServerUsage.aggregate([
      { $match: matchQuery },
      { $sort: { date: -1 } },
      {
        $project: {
          date: 1,
          totalRequests: 1,
          peakRequestsPerMinute: 1,
          peakRequestTime: 1,
          averageResponseTime: 1,
          p95ResponseTime: 1,
          p99ResponseTime: 1,
          'cpu.averageUsage': 1,
          'cpu.peakUsage': 1,
          'memory.averageUsage': 1,
          'memory.peakUsage': 1,
          'dbOperations.averageQueryTime': 1,
          'dbOperations.slowQueries': 1,
          'errors.totalErrors': 1,
          'errors.errorRate': 1,
          'network.totalBandwidth': 1,
          'health.overall': 1,
          hourlyStats: 1
        }
      }
    ]);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get server health summary
exports.getHealthSummary = async (req, res) => {
  try {
    const last7Days = await DailyServerUsage.find({
      date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).sort({ date: -1 });
    
    const today = await DailyServerUsage.findOne({
      date: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });
    
    const summary = {
      current: serverMonitor.getCurrentStats(),
      today: today,
      weekTrend: last7Days,
      healthScore: today?.health?.overall || 'good',
      uptime: today?.health?.uptime || 100,
      totalIncidents: last7Days.reduce((sum, day) => sum + (day.health?.incidents?.length || 0), 0)
    };
    
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
