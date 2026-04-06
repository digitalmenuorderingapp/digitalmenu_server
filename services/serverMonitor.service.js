const os = require('os');
const process = require('process');
const DailyServerUsage = require('../models/DailyServerUsage');

class ServerMonitor {
  constructor() {
    this.requestCount = 0;
    this.responseTimes = [];
    this.currentMinuteRequests = 0;
    this.currentMinuteStart = Date.now();
    this.peakRequestsPerMinute = 0;
    this.peakRequestTime = null;
    this.dbQueryTimes = [];
    this.errorCount = 0;
    this.activeConnections = 0;
    this.bandwidthUsage = { inbound: 0, outbound: 0 };
    this.hourlyStats = new Array(24).fill(null).map(() => ({
      requests: 0,
      responseTimes: [],
      cpuUsage: [],
      memoryUsage: [],
      errorCount: 0
    }));
    
    this.startMonitoring();
  }

  startMonitoring() {
    // Reset counters every minute
    setInterval(() => {
      this.resetMinuteCounters();
    }, 60000);

    // Save daily stats at midnight
    setInterval(() => {
      this.saveDailyStats();
    }, 60 * 60 * 1000); // Check every hour

    // System resource monitoring every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Initial system metrics collection
    this.collectSystemMetrics();
  }

  resetMinuteCounters() {
    const now = Date.now();
    const currentMinuteRequests = this.currentMinuteRequests;
    
    if (currentMinuteRequests > this.peakRequestsPerMinute) {
      this.peakRequestsPerMinute = currentMinuteRequests;
      this.peakRequestTime = new Date(now);
    }
    
    this.currentMinuteRequests = 0;
    this.currentMinuteStart = now;
  }

  collectSystemMetrics() {
    const now = new Date();
    const hour = now.getHours();
    
    // CPU Usage (simplified)
    const cpuUsage = this.getCPUUsage();
    this.hourlyStats[hour].cpuUsage.push(cpuUsage);
    
    // Memory Usage
    const memoryUsage = this.getMemoryUsage();
    this.hourlyStats[hour].memoryUsage.push(memoryUsage);
  }

  getCPUUsage() {
    // Simplified CPU usage calculation
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    return Math.round(((totalTick - totalIdle) / totalTick) * 100);
  }

  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return Math.round((usedMem / totalMem) * 100);
  }

  trackRequest(req, res, next) {
    const startTime = Date.now();
    this.requestCount++;
    this.currentMinuteRequests++;
    this.activeConnections++;
    
    // Track bandwidth (simplified)
    const contentLength = parseInt(req.headers['content-length'] || '0');
    this.bandwidthUsage.inbound += contentLength;
    
    // Track response
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      this.responseTimes.push(responseTime);
      
      const hour = new Date().getHours();
      this.hourlyStats[hour].requests++;
      this.hourlyStats[hour].responseTimes.push(responseTime);
      
      // Track response bandwidth
      const resContentLength = parseInt(res.get('content-length') || '0');
      this.bandwidthUsage.outbound += resContentLength;
      
      // Track errors
      if (res.statusCode >= 400) {
        this.errorCount++;
        this.hourlyStats[hour].errorCount++;
      }
      
      this.activeConnections--;
    });
    
    next();
  }

  trackDatabaseQuery(queryTime) {
    this.dbQueryTimes.push(queryTime);
  }

  async saveDailyStats() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of day
      
      // Check if we already have stats for today
      let dailyStats = await DailyServerUsage.findOne({ date: today });
      
      if (!dailyStats) {
        dailyStats = new DailyServerUsage({ date: today });
      }
      
      // Calculate metrics
      const avgResponseTime = this.responseTimes.length > 0 
        ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length 
        : 0;
      
      const sortedResponseTimes = [...this.responseTimes].sort((a, b) => a - b);
      const p95Index = Math.floor(sortedResponseTimes.length * 0.95);
      const p99Index = Math.floor(sortedResponseTimes.length * 0.99);
      
      const avgDbQueryTime = this.dbQueryTimes.length > 0
        ? this.dbQueryTimes.reduce((a, b) => a + b, 0) / this.dbQueryTimes.length
        : 0;
      
      const slowQueries = this.dbQueryTimes.filter(time => time > 100).length;
      
      // Update daily stats
      dailyStats.totalRequests = this.requestCount;
      dailyStats.peakRequestsPerMinute = this.peakRequestsPerMinute;
      dailyStats.peakRequestTime = this.peakRequestTime;
      
      dailyStats.averageResponseTime = Math.round(avgResponseTime);
      dailyStats.minResponseTime = this.responseTimes.length > 0 ? Math.min(...this.responseTimes) : 0;
      dailyStats.maxResponseTime = this.responseTimes.length > 0 ? Math.max(...this.responseTimes) : 0;
      dailyStats.p95ResponseTime = sortedResponseTimes[p95Index] || 0;
      dailyStats.p99ResponseTime = sortedResponseTimes[p99Index] || 0;
      
      dailyStats.dbOperations.totalQueries = this.dbQueryTimes.length;
      dailyStats.dbOperations.averageQueryTime = Math.round(avgDbQueryTime);
      dailyStats.dbOperations.slowQueries = slowQueries;
      
      dailyStats.cpu.averageUsage = this.calculateHourlyAverage('cpuUsage');
      dailyStats.cpu.peakUsage = Math.max(0, ...this.hourlyStats.map(h => h.cpuUsage.length > 0 ? Math.max(...h.cpuUsage) : 0));
      
      dailyStats.memory.averageUsage = this.calculateHourlyAverage('memoryUsage');
      dailyStats.memory.peakUsage = Math.max(0, ...this.hourlyStats.map(h => h.memoryUsage.length > 0 ? Math.max(...h.memoryUsage) : 0));
      dailyStats.memory.totalUsed = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024); // MB
      dailyStats.memory.totalAvailable = Math.round(os.totalmem() / 1024 / 1024); // MB
      
      dailyStats.network.totalBandwidth = Math.round((this.bandwidthUsage.inbound + this.bandwidthUsage.outbound) / 1024 / 1024); // MB
      dailyStats.network.incomingBandwidth = Math.round(this.bandwidthUsage.inbound / 1024 / 1024); // MB
      dailyStats.network.outgoingBandwidth = Math.round(this.bandwidthUsage.outbound / 1024 / 1024); // MB
      dailyStats.network.peakConnections = this.activeConnections;
      
      dailyStats.errorStats.totalErrors = this.errorCount;
      dailyStats.errorStats.errorRate = this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0;
      
      // Update hourly stats
      dailyStats.hourlyStats = this.hourlyStats.map((hour, index) => ({
        hour: index,
        requests: hour.requests,
        averageResponseTime: hour.responseTimes.length > 0 
          ? Math.round(hour.responseTimes.reduce((a, b) => a + b, 0) / hour.responseTimes.length)
          : 0,
        cpuUsage: hour.cpuUsage.length > 0 
          ? Math.round(hour.cpuUsage.reduce((a, b) => a + b, 0) / hour.cpuUsage.length)
          : 0,
        memoryUsage: hour.memoryUsage.length > 0 
          ? Math.round(hour.memoryUsage.reduce((a, b) => a + b, 0) / hour.memoryUsage.length)
          : 0,
        errorCount: hour.errorCount
      }));
      
      // Determine overall health
      dailyStats.health.overall = this.calculateOverallHealth(dailyStats);
      
      await dailyStats.save();
      console.log(`[ServerMonitor] Daily stats saved for ${today.toISOString().split('T')[0]}`);
      
    } catch (error) {
      console.error('[ServerMonitor] Error saving daily stats:', error);
    }
  }

  calculateHourlyAverage(metric) {
    const allValues = this.hourlyStats.flatMap(hour => hour[metric]);
    return allValues.length > 0 ? Math.round(allValues.reduce((a, b) => a + b, 0) / allValues.length) : 0;
  }

  calculateOverallHealth(stats) {
    const errorRate = stats.errorStats.errorRate;
    const avgResponseTime = stats.averageResponseTime;
    const cpuUsage = stats.cpu.averageUsage;
    const memoryUsage = stats.memory.averageUsage;
    
    if (errorRate > 10 || avgResponseTime > 2000 || cpuUsage > 90 || memoryUsage > 90) {
      return 'critical';
    } else if (errorRate > 5 || avgResponseTime > 1000 || cpuUsage > 80 || memoryUsage > 80) {
      return 'poor';
    } else if (errorRate > 2 || avgResponseTime > 500 || cpuUsage > 70 || memoryUsage > 70) {
      return 'fair';
    } else if (errorRate > 1 || avgResponseTime > 200 || cpuUsage > 50 || memoryUsage > 50) {
      return 'good';
    } else {
      return 'excellent';
    }
  }

  // Get current real-time stats (not from DB)
  getCurrentStats() {
    const now = new Date();
    const hour = now.getHours();
    const currentHourStats = this.hourlyStats[hour];
    
    return {
      timestamp: now,
      requests: {
        total: this.requestCount,
        currentMinute: this.currentMinuteRequests,
        peakPerMinute: this.peakRequestsPerMinute,
        peakTime: this.peakRequestTime
      },
      performance: {
        averageResponseTime: currentHourStats.responseTimes.length > 0
          ? Math.round(currentHourStats.responseTimes.reduce((a, b) => a + b, 0) / currentHourStats.responseTimes.length)
          : 0,
        activeConnections: this.activeConnections,
        errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0
      },
      system: {
        cpuUsage: this.getCPUUsage(),
        memoryUsage: this.getMemoryUsage(),
        memoryUsed: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024), // MB
        memoryTotal: Math.round(os.totalmem() / 1024 / 1024), // MB
        uptime: Math.round(process.uptime()),
        nodeVersion: process.version,
        platform: os.platform()
      },
      network: {
        bandwidthUsed: Math.round((this.bandwidthUsage.inbound + this.bandwidthUsage.outbound) / 1024 / 1024), // MB
        activeConnections: this.activeConnections
      }
    };
  }

  // Reset daily counters (call at midnight)
  resetDailyCounters() {
    this.requestCount = 0;
    this.responseTimes = [];
    this.peakRequestsPerMinute = 0;
    this.peakRequestTime = null;
    this.dbQueryTimes = [];
    this.errorCount = 0;
    this.bandwidthUsage = { inbound: 0, outbound: 0 };
    this.hourlyStats = new Array(24).fill(null).map(() => ({
      requests: 0,
      responseTimes: [],
      cpuUsage: [],
      memoryUsage: [],
      errorCount: 0
    }));
  }
}

// Create singleton instance
const serverMonitor = new ServerMonitor();

module.exports = serverMonitor;
