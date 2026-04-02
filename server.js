const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { updateLastSeen } = require('./middleware/lastSeen.middleware');
const { initCron } = require('./services/cron.service');

dotenv.config();

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
  process.env.ADMIN_URL,
  process.env.SUPERADMIN_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
].filter(origin => origin && typeof origin === 'string')
 .map(origin => origin.trim().replace(/\/$/, ''));

// CORS Check Function
const checkOrigin = (origin, callback) => {
  // Allow requests with no origin (like mobile apps or curl)
  if (!origin) return callback(null, true);
  
  const normalizedOrigin = origin.trim().replace(/\/$/, '');
  if (allowedOrigins.includes(normalizedOrigin)) {
    callback(null, true);
  } else {
    // In production, you might want to be quieter
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[CORS] Blocked Origin: ${origin}`);
    }
    callback(null, false);
  }
};

// Socket.io configuration
const io = new Server(server, {
  cors: {
    origin: checkOrigin,
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Make io accessible to routers
app.set('io', io);

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  socket.on('join', (room) => {
    socket.join(room);
    console.log(`[Socket] ${socket.id} joined room: ${room}`);
    // Log all rooms this socket is in
    console.log(`[Socket] ${socket.id} is now in rooms:`, Array.from(socket.rooms));
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// System monitoring (Request tracking)
const { systemMonitor } = require('./middleware/systemMonitor');
app.use(systemMonitor);

// CORS configuration
app.use(cors({
  origin: checkOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/digitalmenu');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Ensure Superadmin Account
    const Superadmin = require('./models/Superadmin');
    const superadminEmail = 'sahin401099@gmail.com';
    const existingSuperadmin = await Superadmin.findOne({ email: superadminEmail });
    
    if (!existingSuperadmin) {
      console.log('--- CREATING SUPERADMIN ACCOUNT ---');
      await Superadmin.create({
        email: superadminEmail,
        name: 'System Admin'
      });
      console.log(`✅ Superadmin account created: ${superadminEmail}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

connectDB().then(() => {
  // Initialize cron jobs
  initCron();
});

// Scheduled task to mark inactive devices offline
setInterval(async () => {
  try {
    const RefreshToken = require('./models/RefreshToken');
    const markedOffline = await RefreshToken.markInactiveDevicesOffline();
    if (markedOffline > 0) {
      console.log(`Marked ${markedOffline} devices as offline`);
    }
  } catch (error) {
    console.error('Error marking devices offline:', error);
  }
}, 60000); // Run every minute

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
