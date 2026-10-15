const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

// An employee's request to correct a past attendance day (forgot to punch in/out, wrong time
// recorded, or was working but no record exists). Once approved, AttendanceLog is rewritten
// from requestedCheckIn/requestedCheckOut and the old values are kept in previousValues.
const RegularizationRequest = sequelize.define('RegularizationRequest', {
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
  attendanceLogId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'attendance_log_id',
    references: {
      model: 'attendance_logs',
      key: 'id'
    }
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  requestType: {
    type: DataTypes.ENUM('MISSED_CHECK_IN', 'MISSED_CHECK_OUT', 'WRONG_TIME', 'MARK_PRESENT'),
    allowNull: false,
    field: 'request_type'
  },
  requestedCheckIn: {
    type: DataTypes.TIME,
    allowNull: true,
    field: 'requested_check_in'
  },
  requestedCheckOut: {
    type: DataTypes.TIME,
    allowNull: true,
    field: 'requested_check_out'
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
  },
  previousValues: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'previous_values'
  }
}, {
  tableName: 'regularization_requests',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['user_id', 'date']
    }
  ],
  validate: {
    checkOutAfterCheckIn() {
      if (this.requestedCheckIn && this.requestedCheckOut && this.requestedCheckOut <= this.requestedCheckIn) {
        throw new Error('Check-out time must be after check-in time');
      }
    }
  }
});

RegularizationRequest.prototype.canBeApproved = function() {
  return this.status === 'PENDING';
};

module.exports = RegularizationRequest;
