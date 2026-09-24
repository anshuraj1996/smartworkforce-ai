const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const WfhRequest = sequelize.define('WfhRequest', {
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
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  startDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'start_date'
  },
  endDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'end_date'
  },
  isHalfDay: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_half_day'
  },
  halfDayType: {
    type: DataTypes.ENUM('MORNING', 'AFTERNOON'),
    allowNull: true,
    field: 'half_day_type'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [5, 500]
    }
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'PENDING'
  },
  approvedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'approved_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'approved_at'
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rejection_reason'
  }
}, {
  tableName: 'wfh_requests',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['user_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['start_date', 'end_date']
    },
    {
      fields: ['user_id', 'start_date', 'end_date']
    }
  ],
  validate: {
    endDateAfterStartDate() {
      if (this.endDate < this.startDate) {
        throw new Error('End date must be after or equal to start date');
      }
    },
    halfDayValidation() {
      if (this.isHalfDay && this.startDate !== this.endDate) {
        throw new Error('Half day WFH can only be for a single day');
      }
      if (this.isHalfDay && !this.halfDayType) {
        throw new Error('Half day type is required for half day WFH');
      }
    }
  }
});

WfhRequest.prototype.getDayCount = function() {
  if (this.isHalfDay) {
    return 0.5;
  }

  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

  return diffDays;
};

WfhRequest.prototype.canBeApproved = function() {
  return this.status === 'PENDING';
};

module.exports = WfhRequest;
