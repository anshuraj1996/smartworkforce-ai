const jwt = require('jsonwebtoken');
const AuthService = require('../services/AuthService');
const { userRepository } = require('../repositories');
const { runWithTenant } = require('../utils/tenantContext');

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

    // User + organization, cached briefly (see AuthService.getAuthContext)
    const context = await AuthService.getAuthContext(decoded.userId);

    if (context.error) {
      return res.status(401).json({
        success: false,
        message: context.error
      });
    }

    req.user = {
      ...context.user,
      organization: context.organization
    };
    req.organizationId = context.user.organizationId;

    // The rest of this request runs with the tenant as ambient context (utils/tenantContext)
    runWithTenant({ organizationId: context.user.organizationId, userId: context.user.id, role: context.user.role }, next);
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
    const targetUser = await userRepository.findInOrg(targetUserId, currentUser.organizationId);
    if (targetUser) {
      return next();
    }
  }

  // Allow managers to access their direct subordinates only, within their own organization
  if (currentUser.role === 'MANAGER') {
    const targetUser = await userRepository.findInOrg(targetUserId, currentUser.organizationId);
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


