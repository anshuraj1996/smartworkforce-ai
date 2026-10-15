const Joi = require('joi');
const { LEAVE_TYPES, POLICY_CATEGORIES, ROLES } = require('../../config/constants');

// Reusable field schemas for event payloads. Events carry ids, dates and enums - never
// names, emails or other personal data - so a topic never becomes a second copy of the
// user table. Consumers that need a name look it up by id.
const id = () => Joi.string().uuid();
const date = () => Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const time = () => Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

module.exports = {
  Joi,
  id,
  date,
  time,
  leaveType: () => Joi.string().valid(...LEAVE_TYPES),
  policyCategory: () => Joi.string().valid(...POLICY_CATEGORIES),
  role: () => Joi.string().valid(...Object.values(ROLES)),
  attendanceType: () => Joi.string().valid('PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'WORK_FROM_HOME')
};
