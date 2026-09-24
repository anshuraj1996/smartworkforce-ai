require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { sequelize } = require('./models');
const { connectRedis } = require('../config/redis');

// Import events system
const { initializeEventHandlers } = require('./events');

// Import middleware
const { authenticate } = require('./middleware/auth');
const { trackRequests } = require('./middleware/metrics');

// Import services (for demo routes)
const AuthService = require('./services/AuthService');
const AttendanceService = require('./services/AttendanceService');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// General middleware
app.use(compression());
app.use(morgan('combined'));
// type: () => true parses the body as JSON regardless of the Content-Type header a client sends -
// tools like Postman sometimes omit/disable it, which otherwise leaves req.body empty
app.use(express.json({ limit: '10mb', type: () => true }));
app.use(express.urlencoded({ extended: true }));
app.use(trackRequests);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'SmartWorkforce AI Backend',
    version: '1.0.0',
    storage: 'PostgreSQL'
  });
});

// API Routes with versioning
app.use('/api/v1', require('./routes/v1'));

// Demo API endpoints for testing
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.log('Login error:', error);
    res.status(401).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/attendance/check-in', authenticate, async (req, res) => {
  try {
    const result = await AttendanceService.checkIn(
      req.user.id, 
      req.user.organizationId, 
      req.body
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/attendance/check-out', authenticate, async (req, res) => {
  try {
    const result = await AttendanceService.checkOut(
      req.user.id, 
      req.user.organizationId, 
      req.body
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/attendance/today', authenticate, async (req, res) => {
  try {
    const result = await AttendanceService.getTodayAttendance(req.user.id);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Additional demo endpoints for testing all functionality
app.get('/api/users/profile', authenticate, async (req, res) => {
  try {
    const result = await AuthService.getUserProfile(req.user.id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/attendance/history', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 30 } = req.query;
    const result = await AttendanceService.getAttendanceHistory(
      req.user.id, 
      startDate, 
      endDate, 
      parseInt(page), 
      parseInt(limit)
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/attendance/stats', authenticate, async (req, res) => {
  try {
    const { month, year } = req.query;
    const result = await AttendanceService.getAttendanceStats(
      req.user.id,
      month ? parseInt(month) : null,
      year ? parseInt(year) : null
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('🗄️  Database connection established');

    await connectRedis();

    // Initialize event handlers
    initializeEventHandlers();

    // Start HTTP server
    app.listen(PORT, () => {
      console.log(`
        Backend Version 2 
🚀 SmartWorkforce AI Backend Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server running on: http://localhost:${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
🗄️  Storage: PostgreSQL
🔒 Security: Enabled (Helmet, CORS, Rate Limiting)
📊 Event System: Active
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 API Endpoints Available:
  POST /api/v1/auth/login
  POST /api/v1/attendance/check-in
  POST /api/v1/attendance/check-out
  GET  /api/v1/attendance/today
  GET  /api/v1/attendance/calendar
  POST /api/v1/wfh/apply
  GET  /api/v1/notifications/me
  GET  /api/v1/announcements/feed
  GET  /health
      `);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;