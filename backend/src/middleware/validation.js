const Joi = require('joi');

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    req.body = value;
    next();
  };
};

// Validation schemas
const schemas = {
  // Auth schemas
  login: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    password: Joi.string().min(6).required().messages({
      'string.min': 'Password must be at least 6 characters long',
      'any.required': 'Password is required'
    })
  }),

  register: Joi.object({
    organizationName: Joi.string().min(2).max(255).required(),
    name: Joi.string().min(2).max(255).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(255).required(),
    timezone: Joi.string().default('Asia/Kolkata')
  }),

  // User schemas
  createUser: Joi.object({
    name: Joi.string().min(2).max(255).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(255).required(),
    role: Joi.string().valid('EMPLOYEE', 'MANAGER', 'HR', 'ADMIN').default('EMPLOYEE'),
    managerId: Joi.string().uuid().allow(null),
    employeeId: Joi.string().max(50).allow(null),
    department: Joi.string().max(100).allow(null)
  }),

  updateUser: Joi.object({
    name: Joi.string().min(2).max(255),
    email: Joi.string().email(),
    role: Joi.string().valid('EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'),
    managerId: Joi.string().uuid().allow(null),
    employeeId: Joi.string().max(50).allow(null),
    department: Joi.string().max(100).allow(null),
    isActive: Joi.boolean()
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).max(255).required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
      'any.only': 'Password confirmation does not match'
    })
  }),

  // Attendance schemas
  checkIn: Joi.object({
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90),
      longitude: Joi.number().min(-180).max(180),
      address: Joi.string().max(500)
    }).allow(null),
    notes: Joi.string().max(500).allow(null, '')
  }),

  checkOut: Joi.object({
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90),
      longitude: Joi.number().min(-180).max(180),
      address: Joi.string().max(500)
    }).allow(null),
    notes: Joi.string().max(500).allow(null, '')
  }),

  // Leave request schemas
  createLeaveRequest: Joi.object({
    startDate: Joi.date().iso().min('now').required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    leaveType: Joi.string().valid(
      'ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY',
      'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'
    ).required(),
    reason: Joi.string().min(10).max(1000).required(),
    isHalfDay: Joi.boolean().default(false),
    halfDayType: Joi.when('isHalfDay', {
      is: true,
      then: Joi.string().valid('MORNING', 'AFTERNOON').required(),
      otherwise: Joi.forbidden()
    }),
    dayCount: Joi.number().min(0.5).max(365).required()
  }),

  // WFH request schemas
  createWfhRequest: Joi.object({
    startDate: Joi.date().iso().min('now').required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    reason: Joi.string().min(5).max(500).required(),
    isHalfDay: Joi.boolean().default(false),
    halfDayType: Joi.when('isHalfDay', {
      is: true,
      then: Joi.string().valid('MORNING', 'AFTERNOON').required(),
      otherwise: Joi.forbidden()
    })
  }),

  approveLeaveRequest: Joi.object({
    action: Joi.string().valid('approve', 'reject').required(),
    rejectionReason: Joi.when('action', {
      is: 'reject',
      then: Joi.string().min(10).max(500).required(),
      otherwise: Joi.forbidden()
    })
  }),

  // Shift schemas
  createShift: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).required(),
    graceMinutes: Joi.number().integer().min(0).max(120).default(15),
    workingDays: Joi.array().items(Joi.number().integer().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
    breakMinutes: Joi.number().integer().min(0).max(240).default(60),
    isDefault: Joi.boolean().default(false)
  }),

  updateShift: Joi.object({
    name: Joi.string().min(2).max(100),
    startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
    endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
    graceMinutes: Joi.number().integer().min(0).max(120),
    workingDays: Joi.array().items(Joi.number().integer().min(0).max(6)).min(1).max(7),
    breakMinutes: Joi.number().integer().min(0).max(240),
    isDefault: Joi.boolean(),
    isActive: Joi.boolean()
  }),

  // Query parameter validation
  attendanceQuery: Joi.object({
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')),
    userId: Joi.string().uuid(),
    type: Joi.string().valid('PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'WORK_FROM_HOME'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10)
  }),

  leaveQuery: Joi.object({
    status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'),
    leaveType: Joi.string().valid(
      'ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY',
      'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'
    ),
    userId: Joi.string().uuid(),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10)
  }),

  analyticsQuery: Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    userId: Joi.string().uuid(),
    department: Joi.string(),
    metricType: Joi.string().valid('attendance', 'leave', 'productivity', 'all').default('all')
  })
};

// Query parameter validation middleware
const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Query validation failed',
        errors
      });
    }

    req.query = value;
    next();
  };
};

// UUID parameter validation
const validateUUID = (paramName) => {
  return (req, res, next) => {
    const paramValue = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(paramValue)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format`
      });
    }
    
    next();
  };
};

module.exports = {
  validate,
  validateQuery,
  validateUUID,
  schemas
};