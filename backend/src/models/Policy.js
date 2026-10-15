const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

// A company policy document (leave rules, code of conduct, IT security...). Editing the content
// bumps `version`, which makes earlier acknowledgements stale so employees have to re-acknowledge.
const Policy = sequelize.define('Policy', {
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
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [3, 200]
    }
  },
  category: {
    type: DataTypes.ENUM('LEAVE', 'ATTENDANCE', 'WFH', 'CODE_OF_CONDUCT', 'IT_SECURITY', 'HR', 'OTHER'),
    allowNull: false,
    defaultValue: 'OTHER'
  },
  summary: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  effectiveDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'effective_date'
  },
  requiresAcknowledgement: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'requires_acknowledgement'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'created_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  updatedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'updated_by',
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'policies',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['organization_id', 'is_active']
    },
    {
      fields: ['category']
    }
  ]
});

module.exports = Policy;
