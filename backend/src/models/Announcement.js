const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const Announcement = sequelize.define('Announcement', {
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
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'created_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 255]
    }
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  category: {
    type: DataTypes.ENUM('GENERAL', 'POLICY', 'FESTIVAL', 'ACHIEVEMENT'),
    allowNull: false,
    defaultValue: 'GENERAL'
  },
  isPinned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_pinned'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'expires_at'
  }
}, {
  tableName: 'announcements',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['organization_id', 'created_at']
    },
    {
      fields: ['category']
    }
  ]
});

Announcement.prototype.isExpired = function() {
  return this.expiresAt ? new Date(this.expiresAt) < new Date() : false;
};

module.exports = Announcement;
