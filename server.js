const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const hpp = require('hpp');
const compression = require('compression');
const { connectDB } = require('./config/db');
const socketService = require('./services/socket.service');
const { initCron } = require('./services/cron.service');
const { systemMonitor } = require('./middleware/systemMonitor');
const serverMonitor = require('./services/serverMonitor.service');

dotenv.config();

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);

// Environment detection debug
console.log(`[ENV] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[ENV] RENDER: ${process.env.RENDER}`);
console.log(`[ENV] Detected Production Mode: ${process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'}`);

const envOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
const allowedOrigins = [
  ...envOrigins,
  'https://digitalmenuorder.vercel.app',
  'https://digitalmenu-superadmin.vercel.app',
].filter(origin => origin && typeof origin === 'string')
  .map(origin => origin.trim().replace(/\/$/, ''));

// CORS Check Function
const checkOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);

  const normalizedOrigin = origin.trim().replace(/\/$/, '');
  if (allowedOrigins.includes(normalizedOrigin)) {
    callback(null, true);
  } else {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[CORS] Blocked Origin: ${origin}`);
    }
    callback(null, false);
  }
};

// Initialize Socket.IO
const io = socketService.init(server, checkOrigin);
app.set('io', io);
serverMonitor.setIo(io);

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// Rate limiting and speed limiters removed as requested for diagnostics.

// Data sanitization
app.use(mongoSanitize());
app.use(xss());

// HTTP Parameter Pollution protection
app.use(hpp());

// Compression middleware
app.use(compression());

// Middleware
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(cookieParser());
app.use(systemMonitor);
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' || req.originalUrl.includes('/auth/')) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const resolvedIp = req.ip;
    console.log(`[IP Debug] ${req.method} ${req.originalUrl} - HeaderIP: ${ip}, ResolvedIP: ${resolvedIp}, TrustProxy: ${app.get('trust proxy')}`);
  }
  next();
});
app.use((req, res, next) => serverMonitor.trackRequest(req, res, next));

// CORS configuration
app.use(cors({
  origin: checkOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Database connection
connectDB().then(() => {
  // Initialize cron jobs
  initCron();

  // Start periodic service status emission to superadmin
  const { emitServiceStatus } = require('./controllers/superadmin.controller');
  setInterval(() => {
    emitServiceStatus(io);
  }, 10000);
});

// Scheduled task to mark inactive devices offline
setInterval(async () => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) return;

    const RestaurantAdmin = require('./models/RestaurantAdmin');
    const Superadmin = require('./models/Superadmin');

    const markedRestaurantOffline = await RestaurantAdmin.markInactiveDevicesOffline();
    const markedSuperadminOffline = await Superadmin.markInactiveDevicesOffline();

    const totalMarked = (markedRestaurantOffline?.modifiedCount || 0) + (markedSuperadminOffline?.modifiedCount || 0);

    if (totalMarked > 0) {
      console.log(`[OfflineSync] Marked ${totalMarked} devices as offline`);
    }
  } catch (error) {
    if (error.name !== 'MongooseError' || !error.message.includes('buffering timed out')) {
      console.error('Error marking devices offline:', error);
    }
  }
}, 60000);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/menu', require('./routes/menu.routes'));
app.use('/api/table', require('./routes/table.routes'));
app.use('/api/order', require('./routes/order.routes'));
app.use('/api/ledger', require('./routes/ledger.routes'));
app.use('/api/devices', require('./routes/devices.routes'));
app.use('/api/public', require('./routes/public.routes'));
app.use('/api/superadmin', require('./routes/superadmin.routes'));
app.use('/api/server-monitoring', require('./routes/serverMonitoring.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'DigitalMenu API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
