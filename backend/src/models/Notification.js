const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const Notification = sequelize.define('Notification', {
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
  category: {
    type: DataTypes.ENUM('ATTENDANCE', 'LEAVE', 'WFH', 'ANNOUNCEMENT', 'HR', 'SYSTEM'),
    allowNull: false,
    defaultValue: 'SYSTEM'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 255]
    }
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  link: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_read'
  },
  readAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'read_at'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'notifications',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['user_id', 'is_read']
    },
    {
      fields: ['user_id', 'created_at']
    },
    {
      fields: ['category']
    }
  ]
});

Notification.prototype.markAsRead = async function() {
  if (this.isRead) return this;
  return this.update({ isRead: true, readAt: new Date() });
};

module.exports = Notification;
