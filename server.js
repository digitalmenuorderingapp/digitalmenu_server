const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { connectDB } = require('./config/db');
const socketService = require('./services/socket.service');
const { initCron } = require('./services/cron.service');
const { systemMonitor } = require('./middleware/systemMonitor');

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const allowedOrigins = [
  'https://digitalmenuorder.vercel.app',
  'https://digitalmenu-superadmin.vercel.app',
  'http://localhost:3001',
  'http://localhost:3000'
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

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(systemMonitor);

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
  }, 30000);
});

// Scheduled task to mark inactive devices offline
setInterval(async () => {
  try {
    const RestaurantAdmin = require('./models/RestaurantAdmin');
    const Superadmin = require('./models/Superadmin');

    const markedRestaurantOffline = await RestaurantAdmin.markInactiveDevicesOffline();
    const markedSuperadminOffline = await Superadmin.markInactiveDevicesOffline();

    const totalMarked = (markedRestaurantOffline?.modifiedCount || 0) + (markedSuperadminOffline?.modifiedCount || 0);

    if (totalMarked > 0) {
      console.log(`[OfflineSync] Marked ${totalMarked} devices as offline`);
    }
  } catch (error) {
    console.error('Error marking devices offline:', error);
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
