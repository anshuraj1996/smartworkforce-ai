require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { sequelize } = require('./models');
const cache = require('./utils/cache');

// Import middleware
const { trackRequests } = require('./middleware/metrics');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true
}));

// Requests arrive through the ingress controller (one proxy hop). Trusting that hop makes req.ip
// the real client from X-Forwarded-For - otherwise every user shares the ingress pod's IP and
// therefore ONE rate-limit budget. TRUST_PROXY_HOPS=0 when nothing sits in front of the app.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10));

// Health endpoints are exempt from rate limiting
const HEALTH_PATHS = ['/v1/health'];

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  // Kubernetes probes /api/v1/health twice every 10s from the node's IP - that alone used up
  // 100 requests in ~8 minutes, the probes got 429, liveness failed and the pod was restarted
  // (~every 9 minutes). Probes must never be rate limited.
  skip: (req) => HEALTH_PATHS.includes(req.path)
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

// Error handling middleware - maps AppError/Sequelize errors to 4xx, everything else to 500
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  await cache.closeCache();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('🗄️  Database connection established');

    // Not awaited on purpose: the API serves requests (uncached) even if Redis is down.
    // No Kafka connection here at all - events go to the outbox table; workers publish them.
    cache.connectCache();

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