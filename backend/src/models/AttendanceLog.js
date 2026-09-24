const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const AttendanceLog = sequelize.define('AttendanceLog', {
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
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  checkInTime: {
    type: DataTypes.TIME,
    allowNull: true,
    field: 'check_in_time'
  },
  checkOutTime: {
    type: DataTypes.TIME,
    allowNull: true,
    field: 'check_out_time'
  },
  checkInTimestamp: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'check_in_timestamp'
  },
  checkOutTimestamp: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'check_out_timestamp'
  },
  attendanceType: {
    type: DataTypes.ENUM('PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'WORK_FROM_HOME'),
    allowNull: false,
    defaultValue: 'PRESENT',
    field: 'attendance_type'
  },
  isInferredCheckout: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_inferred_checkout'
  },
  workingMinutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'working_minutes'
  },
  lateMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'late_minutes'
  },
  earlyLeaveMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'early_leave_minutes'
  },
  location: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'attendance_logs',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['user_id', 'date'],
      unique: true
    },
    {
      fields: ['date']
    },
    {
      fields: ['check_in_timestamp']
    },
    {
      fields: ['check_out_timestamp']
    },
    {
      fields: ['attendance_type']
    },
    {
      fields: ['user_id', 'date', 'attendance_type']
    }
  ]
});

// Instance methods
AttendanceLog.prototype.calculateWorkingMinutes = function() {
  if (this.checkInTimestamp && this.checkOutTimestamp) {
    const diff = new Date(this.checkOutTimestamp) - new Date(this.checkInTimestamp);
    return Math.floor(diff / (1000 * 60)); // Convert to minutes
  }
  return 0;
};

AttendanceLog.prototype.isComplete = function() {
  return this.checkInTimestamp && this.checkOutTimestamp;
};

module.exports = AttendanceLog;