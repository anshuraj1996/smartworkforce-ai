const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

// One row per user per policy version they've read and accepted
const PolicyAcknowledgement = sequelize.define('PolicyAcknowledgement', {
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
  policyId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'policy_id',
    references: {
      model: 'policies',
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
  version: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  acknowledgedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'acknowledged_at'
  }
}, {
  tableName: 'policy_acknowledgements',
  indexes: [
    {
      fields: ['policy_id', 'user_id', 'version'],
      unique: true
    },
    {
      fields: ['user_id']
    }
  ]
});

module.exports = PolicyAcknowledgement;
