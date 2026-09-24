const jwt = require('jsonwebtoken');
const { User, Organization } = require('../models');

// Generate JWT token
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: process.env.JWT_EXPIRES_IN || '2h'
  });
};

// Verify JWT token
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
};

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const decoded = verifyToken(token);

    // Find user
    const user = await User.findOne({
      where: { id: decoded.userId, isActive: true }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive user'
      });
    }

    // Find organization
    const organization = await Organization.findOne({
      where: { id: user.organizationId, isActive: true }
    });

    if (!organization) {
      return res.status(401).json({
        success: false,
        message: 'Organization is inactive'
      });
    }

    // toJSON() already strips the password (see User model)
    req.user = {
      ...user.toJSON(),
      organization
    };
    req.organizationId = user.organizationId;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Authorization middleware - check if user has required role
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Check if user can access resource (same user or manager/hr/admin)
const authorizeResourceAccess = async (req, res, next) => {
  const targetUserId = req.params.userId || req.body.userId;
  const currentUser = req.user;

  // Allow if accessing own resource
  if (targetUserId === currentUser.id) {
    return next();
  }

  // Allow if user has administrative role, but only within their own organization
  if (['ADMIN', 'HR'].includes(currentUser.role)) {
    const targetUser = await User.findOne({ where: { id: targetUserId, organizationId: currentUser.organizationId } });
    if (targetUser) {
      return next();
    }
  }

  // Allow managers to access their direct subordinates only, within their own organization
  if (currentUser.role === 'MANAGER') {
    const targetUser = await User.findOne({ where: { id: targetUserId, organizationId: currentUser.organizationId } });
    if (targetUser && targetUser.managerId === currentUser.id) {
      return next();
    }
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied to this resource'
  });
};

// Organization isolation middleware - ensures users can only access their org data
const enforceOrganizationIsolation = (req, res, next) => {
  // Add organization filter to query parameters
  req.organizationFilter = { organizationId: req.organizationId };
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  authorize,
  authorizeResourceAccess,
  enforceOrganizationIsolation
};


