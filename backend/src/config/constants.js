// Domain constants shared by routes, services and validation schemas

const ROLES = {
  EMPLOYEE: 'EMPLOYEE',
  MANAGER: 'MANAGER',
  HR: 'HR',
  ADMIN: 'ADMIN'
};

// Role groups used with authorize(...)
const IS_MANAGER_UP = [ROLES.MANAGER, ROLES.HR, ROLES.ADMIN];
const IS_HR_UP = [ROLES.HR, ROLES.ADMIN];

const LEAVE_TYPES = [
  'ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY',
  'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'
];

const POLICY_CATEGORIES = ['LEAVE', 'ATTENDANCE', 'WFH', 'CODE_OF_CONDUCT', 'IT_SECURITY', 'HR', 'OTHER'];

const API_VERSION = '1.0.0';

module.exports = {
  ROLES,
  IS_MANAGER_UP,
  IS_HR_UP,
  LEAVE_TYPES,
  POLICY_CATEGORIES,
  API_VERSION
};
