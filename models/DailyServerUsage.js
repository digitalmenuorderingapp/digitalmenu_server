const mongoose = require('mongoose');

const dailyServerUsageSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true,
    unique: true
  },
  
  // Request metrics
  totalRequests: {
    type: Number,
    default: 0
  },
  peakRequestsPerMinute: {
    type: Number,
    default: 0
  },
  peakRequestTime: {
    type: Date,
    default: null
  },
  
  // Performance metrics
  averageResponseTime: {
    type: Number,
    default: 0 // milliseconds
  },
  minResponseTime: {
    type: Number,
    default: 0
  },
  maxResponseTime: {
    type: Number,
    default: 0
  },
  p95ResponseTime: {
    type: Number,
    default: 0
  },
  p99ResponseTime: {
    type: Number,
    default: 0
  },
  
  // Database performance
  dbOperations: {
    totalQueries: { type: Number, default: 0 },
    averageQueryTime: { type: Number, default: 0 }, // milliseconds
    slowQueries: { type: Number, default: 0 }, // > 100ms
    failedQueries: { type: Number, default: 0 },
    connectionPoolUsage: { type: Number, default: 0 } // percentage
  },
  
  // System resources
  cpu: {
    averageUsage: { type: Number, default: 0 }, // percentage
    peakUsage: { type: Number, default: 0 },
    peakTime: { type: Date, default: null }
  },
  memory: {
    averageUsage: { type: Number, default: 0 }, // percentage
    peakUsage: { type: Number, default: 0 },
    peakTime: { type: Date, default: null },
    totalUsed: { type: Number, default: 0 }, // MB
    totalAvailable: { type: Number, default: 0 } // MB
  },
  disk: {
    usage: { type: Number, default: 0 }, // percentage
    readOperations: { type: Number, default: 0 },
    writeOperations: { type: Number, default: 0 },
    averageReadTime: { type: Number, default: 0 }, // milliseconds
    averageWriteTime: { type: Number, default: 0 } // milliseconds
  },
  
  // Network metrics
  network: {
    totalBandwidth: { type: Number, default: 0 }, // MB
    incomingBandwidth: { type: Number, default: 0 }, // MB
    outgoingBandwidth: { type: Number, default: 0 }, // MB
    activeConnections: { type: Number, default: 0 },
    peakConnections: { type: Number, default: 0 },
    peakConnectionTime: { type: Date, default: null }
  },
  
  // Error tracking
  errorStats: {
    totalErrors: { type: Number, default: 0 },
    errorRate: { type: Number, default: 0 }, // percentage
    serverErrors: { type: Number, default: 0 }, // 5xx
    clientErrors: { type: Number, default: 0 }, // 4xx
    timeouts: { type: Number, default: 0 }
  },
  
  // API endpoint breakdown
  endpoints: [{
    path: { type: String, required: true },
    method: { type: String, required: true },
    requests: { type: Number, default: 0 },
    averageResponseTime: { type: Number, default: 0 },
    errorRate: { type: Number, default: 0 }
  }],
  
  // Hourly breakdown for detailed analysis
  hourlyStats: [{
    hour: { type: Number, min: 0, max: 23, required: true },
    requests: { type: Number, default: 0 },
    averageResponseTime: { type: Number, default: 0 },
    cpuUsage: { type: Number, default: 0 },
    memoryUsage: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 }
  }],
  
  // Health indicators
  health: {
    overall: { type: String, enum: ['excellent', 'good', 'fair', 'poor', 'critical'], default: 'good' },
    uptime: { type: Number, default: 100 }, // percentage
    downtimeMinutes: { type: Number, default: 0 },
    incidents: [{
      time: { type: Date, required: true },
      type: { type: String, required: true },
      severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
      description: { type: String, required: true },
      resolved: { type: Boolean, default: false },
      resolvedAt: { type: Date, default: null }
    }]
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
dailyServerUsageSchema.index({ date: -1 });
dailyServerUsageSchema.index({ 'health.overall': 1, date: -1 });
dailyServerUsageSchema.index({ 'cpu.peakUsage': -1, date: -1 });
dailyServerUsageSchema.index({ 'memory.peakUsage': -1, date: -1 });
dailyServerUsageSchema.index({ totalRequests: -1, date: -1 });

// Static methods for aggregation
dailyServerUsageSchema.statics.getUsageTrend = function(days = 30) {
  return this.aggregate([
    { $match: { date: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } } },
    { $sort: { date: 1 } },
    {
      $project: {
        date: 1,
        totalRequests: 1,
        averageResponseTime: 1,
        'cpu.averageUsage': 1,
        'memory.averageUsage': 1,
        'errors.errorRate': 1,
        'health.overall': 1
      }
    }
  ]);
};

dailyServerUsageSchema.statics.getPeakUsageTimes = function(days = 7) {
  return this.aggregate([
    { $match: { date: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } } },
    { $sort: { date: -1 } },
    {
      $project: {
        date: 1,
        peakRequestsPerMinute: 1,
        peakRequestTime: 1,
        'cpu.peakUsage': 1,
        'cpu.peakTime': 1,
        'memory.peakUsage': 1,
        'memory.peakTime': 1,
        'network.peakConnections': 1,
        'network.peakConnectionTime': 1
      }
    }
  ]);
};

dailyServerUsageSchema.statics.getEndpointPerformance = function(days = 7) {
  return this.aggregate([
    { $match: { date: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } } },
    { $unwind: '$endpoints' },
    {
      $group: {
        _id: { path: '$endpoints.path', method: '$endpoints.method' },
        totalRequests: { $sum: '$endpoints.requests' },
        avgResponseTime: { $avg: '$endpoints.averageResponseTime' },
        avgErrorRate: { $avg: '$endpoints.errorRate' },
        maxRequests: { $max: '$endpoints.requests' }
      }
    },
    { $sort: { totalRequests: -1 } }
  ]);
};

module.exports = mongoose.model('DailyServerUsage', dailyServerUsageSchema);
