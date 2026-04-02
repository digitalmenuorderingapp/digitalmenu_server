const os = require('os');
const mongoose = require('mongoose');

// In-memory metrics storage (resets on server restart)
let metrics = {
  totalRequests: 0,
  todayRequests: 0,
  totalResponseTime: 0,
  requestCountForAvg: 0,
  lastResetDate: new Date().toLocaleDateString(),
  activeConnections: 0
};

// CPU tracking for cross-platform usage calculation
let lastCPUUsage = process.cpuUsage();
let lastCPUTime = Date.now();

/**
 * Get CPU usage percentage (cross-platform)
 */
const getCPUUsage = () => {
  const currentUsage = process.cpuUsage();
  const currentTime = Date.now();
  
  // Calculate elapsed time in microseconds
  const elapsedTime = (currentTime - lastCPUTime) * 1000;
  
  // Calculate CPU time used (user + system) in microseconds
  const userDiff = currentUsage.user - lastCPUUsage.user;
  const systemDiff = currentUsage.system - lastCPUUsage.system;
  const totalCPUTime = userDiff + systemDiff;
  
  // Calculate percentage (CPU time / elapsed time * 100)
  // Divide by number of cores since process.cpuUsage gives per-process time
  const cpuCount = os.cpus().length;
  const percentage = (totalCPUTime / (elapsedTime * cpuCount)) * 100;
  
  // Update last values
  lastCPUUsage = currentUsage;
  lastCPUTime = currentTime;
  
  // Return bounded value (0-100%)
  return Math.min(100, Math.max(0, percentage)).toFixed(1);
};

/**
 * Get Database size info
 */
const getDatabaseInfo = async () => {
  try {
    if (!mongoose.connection.readyState) {
      return { status: 'disconnected', size: 0, dataSize: 0 };
    }
    
    const dbStats = await mongoose.connection.db.stats();
    return {
      status: 'connected',
      size: dbStats.storageSize || 0,
      dataSize: dbStats.dataSize || 0,
      collections: dbStats.collections || 0,
      documents: dbStats.objects || 0
    };
  } catch (error) {
    return { status: 'error', size: 0, dataSize: 0 };
  }
};

/**
 * Global System Monitoring Middleware
 */
const systemMonitor = (req, res, next) => {
  const start = Date.now();
  const currentDate = new Date().toLocaleDateString();

  // Reset daily counter if date changed
  if (currentDate !== metrics.lastResetDate) {
    metrics.todayRequests = 0;
    metrics.lastResetDate = currentDate;
  }

  metrics.totalRequests++;
  metrics.todayRequests++;

  // Intercept response finish to calculate time
  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.totalResponseTime += duration;
    metrics.requestCountForAvg++;
  });

  next();
};

/**
 * Helper to get current metrics (async for DB info)
 */
const getMetrics = async () => {
  const avgResponseTime = metrics.requestCountForAvg > 0 
    ? (metrics.totalResponseTime / metrics.requestCountForAvg).toFixed(2) 
    : 0;

  const dbInfo = await getDatabaseInfo();

  return {
    ...metrics,
    avgResponseTime: parseFloat(avgResponseTime),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: parseFloat(getCPUUsage()), // Cross-platform CPU percentage
    database: dbInfo, // Database size and status
    platform: os.platform(),
    nodeVersion: process.version
  };
};

module.exports = {
  systemMonitor,
  getMetrics,
  getDatabaseInfo
};
