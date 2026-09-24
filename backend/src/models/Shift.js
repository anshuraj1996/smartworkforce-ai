const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const Shift = sequelize.define('Shift', {
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
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  startTime: {
    type: DataTypes.TIME,
    allowNull: false,
    field: 'start_time'
  },
  endTime: {
    type: DataTypes.TIME,
    allowNull: false,
    field: 'end_time'
  },
  graceMinutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 15,
    field: 'grace_minutes',
    validate: {
      min: 0,
      max: 120
    }
  },
  isDefault: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_default'
  },
  workingDays: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    defaultValue: [1, 2, 3, 4, 5], // Monday to Friday
    field: 'working_days',
    validate: {
      isValidDays(value) {
        if (!Array.isArray(value)) {
          throw new Error('Working days must be an array');
        }
        const validDays = value.every(day => day >= 0 && day <= 6);
        if (!validDays) {
          throw new Error('Working days must be between 0-6 (Sunday=0)');
        }
      }
    }
  },
  breakMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 60,
    field: 'break_minutes',
    validate: {
      min: 0,
      max: 240
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'shifts',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['is_default']
    },
    {
      fields: ['is_active']
    },
    {
      fields: ['organization_id', 'name'],
      unique: true
    }
  ]
});

// Instance methods
Shift.prototype.getWorkingMinutes = function() {
  const start = new Date(`1970-01-01T${this.startTime}Z`);
  const end = new Date(`1970-01-01T${this.endTime}Z`);
  
  // Handle overnight shifts
  if (end < start) {
    end.setDate(end.getDate() + 1);
  }
  
  const diffMs = end - start;
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  return totalMinutes - this.breakMinutes;
};

Shift.prototype.isWorkingDay = function(dayOfWeek) {
  return this.workingDays.includes(dayOfWeek);
};

module.exports = Shift;