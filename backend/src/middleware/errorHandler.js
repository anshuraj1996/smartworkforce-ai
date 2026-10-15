const { AppError } = require('../utils/errors');

const { API_VERSION } = require('../config/constants');

// Single place that decides the HTTP status and message for a failed request.
// - AppError subclasses: their own status + message (safe to show the client)
// - Sequelize validation / unique errors: 400 / 409 with the model's message
// - Anything else is a bug: logged in full, client gets a generic 500 in production
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      version: API_VERSION
    });
  }

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      success: false,
      message: err.errors.map(e => e.message).join(', '),
      version: API_VERSION
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      success: false,
      message: 'A record with these details already exists',
      version: API_VERSION
    });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    version: API_VERSION
  });
};

module.exports = errorHandler;
