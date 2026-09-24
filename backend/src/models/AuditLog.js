const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const AuditLog = sequelize.define('AuditLog', {
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
  actorId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'actor_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  action: {
    type: DataTypes.ENUM(
      'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
      'CHECK_IN', 'CHECK_OUT', 'LEAVE_APPLY', 'LEAVE_APPROVE',
      'LEAVE_REJECT', 'SHIFT_ASSIGN', 'ROLE_CHANGE', 'PASSWORD_CHANGE',
      'SYSTEM_AUTO_CHECKOUT', 'AI_INSIGHT_GENERATED', 'POLICY_VIOLATION'
    ),
    allowNull: false
  },
  entityType: {
    type: DataTypes.ENUM(
      'USER', 'ORGANIZATION', 'ATTENDANCE_LOG', 'LEAVE_REQUEST',
      'SHIFT', 'AI_INSIGHT', 'AUDIT_LOG', 'SYSTEM',
      'WFH_REQUEST', 'ANNOUNCEMENT', 'NOTIFICATION'
    ),
    allowNull: false,
    field: 'entity_type'
  },
  entityId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'entity_id'
  },
  previousValues: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'previous_values'
  },
  newValues: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'new_values'
  },
  ipAddress: {
    type: DataTypes.INET,
    allowNull: true,
    field: 'ip_address'
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'user_agent'
  },
  sessionId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'session_id'
  },
  source: {
    type: DataTypes.ENUM('WEB', 'MOBILE', 'API', 'SYSTEM', 'BACKGROUND_JOB'),
    allowNull: false,
    defaultValue: 'WEB'
  },
  severity: {
    type: DataTypes.ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL'),
    allowNull: false,
    defaultValue: 'INFO'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'audit_logs',
  timestamps: false, // We use custom timestamp field
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['actor_id']
    },
    {
      fields: ['action']
    },
    {
      fields: ['entity_type']
    },
    {
      fields: ['entity_id']
    },
    {
      fields: ['timestamp']
    },
    {
      fields: ['severity']
    },
    {
      fields: ['source']
    },
    {
      fields: ['organization_id', 'timestamp']
    },
    {
      fields: ['actor_id', 'timestamp']
    },
    {
      fields: ['entity_type', 'entity_id', 'timestamp']
    },
    {
      fields: ['action', 'timestamp']
    }
  ]
});

// Static methods
AuditLog.logAction = async function(params) {
  const {
    organizationId,
    actorId,
    action,
    entityType,
    entityId,
    previousValues = null,
    newValues = null,
    ipAddress = null,
    userAgent = null,
    sessionId = null,
    source = 'WEB',
    severity = 'INFO',
    description = null,
    metadata = {}
  } = params;

  try {
    return await this.create({
      organizationId,
      actorId,
      action,
      entityType,
      entityId,
      previousValues,
      newValues,
      ipAddress,
      userAgent,
      sessionId,
      source,
      severity,
      description,
      metadata
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break the main flow
    return null;
  }
};

AuditLog.logLogin = function(params) {
  return this.logAction({
    ...params,
    action: 'LOGIN',
    entityType: 'USER',
    entityId: params.actorId,
    description: 'User logged in'
  });
};

AuditLog.logLogout = function(params) {
  return this.logAction({
    ...params,
    action: 'LOGOUT',
    entityType: 'USER',
    entityId: params.actorId,
    description: 'User logged out'
  });
};

AuditLog.logAttendance = function(params) {
  const { action, ...rest } = params;
  return this.logAction({
    ...rest,
    action: action === 'check-in' ? 'CHECK_IN' : 'CHECK_OUT',
    entityType: 'ATTENDANCE_LOG',
    description: `User ${action === 'check-in' ? 'checked in' : 'checked out'}`
  });
};

AuditLog.logLeaveAction = function(params) {
  const actionMap = {
    'apply': 'LEAVE_APPLY',
    'approve': 'LEAVE_APPROVE', 
    'reject': 'LEAVE_REJECT'
  };
  
  return this.logAction({
    ...params,
    action: actionMap[params.leaveAction] || 'LEAVE_APPLY',
    entityType: 'LEAVE_REQUEST',
    description: `Leave request ${params.leaveAction}d`
  });
};

// Instance methods
AuditLog.prototype.getFormattedTimestamp = function() {
  return this.timestamp.toISOString();
};

AuditLog.prototype.hasChanges = function() {
  return this.previousValues || this.newValues;
};

module.exports = AuditLog;