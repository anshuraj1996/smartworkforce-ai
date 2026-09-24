const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const Organization = sequelize.define('Organization', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 255]
    }
  },
  timezone: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Asia/Kolkata',
    validate: {
      notEmpty: true
    }
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      defaultShiftStart: '09:00',
      defaultShiftEnd: '17:00',
      defaultGraceMinutes: 15,
      autoCheckout: true,
      requireApproval: true
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  }
}, {
  tableName: 'organizations',
  indexes: [
    {
      fields: ['name']
    },
    {
      fields: ['is_active']
    }
  ]
});

module.exports = Organization;