const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

// Per-organization yearly allocation for one leave type. Leave balances are computed from these;
// an org with no rows falls back to LeaveService's default allocations.
const LeavePolicy = sequelize.define('LeavePolicy', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
    references: {
      model: 'organizations',
      key: 'id'
    }
  },
  leaveType: {
    type: DataTypes.ENUM(
      'ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY',
      'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'
    ),
    allowNull: false,
    field: 'leave_type'
  },
  annualAllocation: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: false,
    field: 'annual_allocation',
    validate: {
      min: 0,
      max: 365
    }
  },
  carryForwardMax: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: false,
    defaultValue: 0,
    field: 'carry_forward_max',
    validate: {
      min: 0,
      max: 365
    }
  },
  // When false, applying beyond the remaining balance is rejected
  allowNegativeBalance: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'allow_negative_balance'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  }
}, {
  tableName: 'leave_policies',
  indexes: [
    {
      fields: ['organization_id', 'leave_type'],
      unique: true
    }
  ]
});

module.exports = LeavePolicy;
