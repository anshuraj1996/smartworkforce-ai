const Joi = require('joi');
const { LEAVE_TYPES, POLICY_CATEGORIES } = require('../config/constants');

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

// HH:MM or HH:MM:SS, 24-hour
const TIME_PATTERN = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

// Kept as a YYYY-MM-DD string (not Joi.date()) so it compares equal to DATEONLY columns
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

  // Attendance regularization schemas
  createRegularizationRequest: Joi.object({
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required().messages({
      'string.pattern.base': 'Date must be in YYYY-MM-DD format'
    }),
    requestType: Joi.string().valid('MISSED_CHECK_IN', 'MISSED_CHECK_OUT', 'WRONG_TIME', 'MARK_PRESENT').required(),
    requestedCheckIn: Joi.string().pattern(TIME_PATTERN).allow(null, ''),
    requestedCheckOut: Joi.string().pattern(TIME_PATTERN).allow(null, ''),
    reason: Joi.string().min(5).max(500).required()
  }),

  // Policy schemas
  createPolicy: Joi.object({
    title: Joi.string().min(3).max(200).required(),
    category: Joi.string().valid(...POLICY_CATEGORIES).default('OTHER'),
    summary: Joi.string().max(500).allow(null, ''),
    content: Joi.string().min(10).required(),
    effectiveDate: Joi.string().pattern(DATE_PATTERN).required(),
    requiresAcknowledgement: Joi.boolean().default(true)
  }),

  updatePolicy: Joi.object({
    title: Joi.string().min(3).max(200),
    category: Joi.string().valid(...POLICY_CATEGORIES),
    summary: Joi.string().max(500).allow(null, ''),
    content: Joi.string().min(10),
    effectiveDate: Joi.string().pattern(DATE_PATTERN),
    requiresAcknowledgement: Joi.boolean(),
    isActive: Joi.boolean()
  }).min(1),

  upsertLeavePolicy: Joi.object({
    annualAllocation: Joi.number().min(0).max(365).required(),
    carryForwardMax: Joi.number().min(0).max(365).default(0),
    allowNegativeBalance: Joi.boolean().default(false),
    isActive: Joi.boolean().default(true)
  }),

  // Hiring / referral schemas
  createJobOpening: Joi.object({
    title: Joi.string().min(3).max(200).required(),
    department: Joi.string().max(100).allow(null, ''),
    location: Joi.string().max(150).allow(null, ''),
    employmentType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN').default('FULL_TIME'),
    experienceMin: Joi.number().integer().min(0).max(50).allow(null),
    experienceMax: Joi.number().integer().min(0).max(50).allow(null),
    description: Joi.string().min(10).required(),
    openings: Joi.number().integer().min(1).max(500).default(1),
    referralBonus: Joi.number().min(0).allow(null)
  }),

  updateJobOpening: Joi.object({
    title: Joi.string().min(3).max(200),
    department: Joi.string().max(100).allow(null, ''),
    location: Joi.string().max(150).allow(null, ''),
    employmentType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'),
    experienceMin: Joi.number().integer().min(0).max(50).allow(null),
    experienceMax: Joi.number().integer().min(0).max(50).allow(null),
    description: Joi.string().min(10),
    openings: Joi.number().integer().min(1).max(500),
    referralBonus: Joi.number().min(0).allow(null),
    status: Joi.string().valid('OPEN', 'ON_HOLD', 'CLOSED')
  }).min(1),

  createReferral: Joi.object({
    candidateName: Joi.string().min(2).max(150).required(),
    candidateEmail: Joi.string().email().required(),
    candidatePhone: Joi.string().max(30).allow(null, ''),
    resumeUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow(null, ''),
    relationship: Joi.string().max(100).allow(null, ''),
    notes: Joi.string().max(2000).allow(null, '')
  }),

  updateReferralStatus: Joi.object({
    status: Joi.string().valid('SCREENING', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN').required(),
    statusNote: Joi.string().max(1000).allow(null, '')
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

  // ---- Analytics (2D) ----
  // Dates stay YYYY-MM-DD strings (not Joi.date()) - they go straight into SQL as calendar days
  periodQuery: Joi.object({
    period: Joi.string().valid('7d', '30d', '90d', '1y')
  }),

  lifecycleQuery: Joi.object({
    months: Joi.number().integer().min(1).max(36).default(12)
  }),

  yearQuery: Joi.object({
    year: Joi.number().integer().min(2000).max(2100)
  }),

  kpiQuery: Joi.object({
    from: Joi.string().pattern(DATE_PATTERN),
    to: Joi.string().pattern(DATE_PATTERN),
    granularity: Joi.string().valid('day', 'week', 'month').default('day'),
    department: Joi.string().trim().max(100)
  }),

  forecastQuery: Joi.object({
    horizonDays: Joi.number().integer().min(7).max(90).default(30),
    department: Joi.string().trim().max(100)
  }),

  assistantChat: Joi.object({
    message: Joi.string().trim().min(1).max(2000).required(),
    // earlier turns, plain text only; the service keeps the last 10
    history: Joi.array().items(Joi.object({
      role: Joi.string().valid('user', 'assistant').required(),
      content: Joi.string().max(4000).required()
    })).max(20).default([])
  }),

  riskQuery: Joi.object({
    department: Joi.string().trim().max(100)
  }),

  leaveForecastQuery: Joi.object({
    weeks: Joi.number().integer().min(4).max(26).default(12),
    department: Joi.string().trim().max(100)
  }),

  createReport: Joi.object({
    reportType: Joi.string().valid('attendance-summary', 'leave-summary').required(),
    from: Joi.string().pattern(DATE_PATTERN).required(),
    to: Joi.string().pattern(DATE_PATTERN).required()
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