const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const LeaveRequest = sequelize.define('LeaveRequest', {
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
  leaveType: {
    type: DataTypes.ENUM(
      'ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY', 
      'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'
    ),
    allowNull: false,
    field: 'leave_type'
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'PENDING'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [10, 1000]
    }
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
  },
  dayCount: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: false,
    field: 'day_count',
    validate: {
      min: 0.5,
      max: 365
    }
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
  attachments: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: []
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'leave_requests',
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
      fields: ['leave_type']
    },
    {
      fields: ['start_date', 'end_date']
    },
    {
      fields: ['approved_by']
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
        throw new Error('Half day leave can only be for a single day');
      }
      if (this.isHalfDay && !this.halfDayType) {
        throw new Error('Half day type is required for half day leave');
      }
    }
  }
});

// Instance methods
LeaveRequest.prototype.getDurationInDays = function() {
  if (this.isHalfDay) {
    return 0.5;
  }
  
  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  return diffDays;
};

LeaveRequest.prototype.canBeApproved = function() {
  return this.status === 'PENDING';
};

LeaveRequest.prototype.canBeCancelled = function() {
  return ['PENDING', 'APPROVED'].includes(this.status) && 
         new Date(this.startDate) > new Date();
};

module.exports = LeaveRequest;