const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const AiInsight = sequelize.define('AiInsight', {
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
    allowNull: true,
    field: 'user_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  insightType: {
    type: DataTypes.ENUM(
      'LATE_ARRIVAL_PATTERN', 
      'EARLY_DEPARTURE_PATTERN',
      'ATTENDANCE_ANOMALY',
      'WORK_HOURS_VARIATION',
      'LEAVE_PATTERN_ANALYSIS',
      'PRODUCTIVITY_INSIGHT',
      'BEHAVIORAL_PATTERN',
      'RISK_ASSESSMENT'
    ),
    allowNull: false,
    field: 'insight_type'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [5, 200]
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  score: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: {
      min: 0,
      max: 100
    }
  },
  severity: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
    allowNull: false,
    defaultValue: 'LOW'
  },
  confidence: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.0,
    validate: {
      min: 0,
      max: 100
    }
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    validate: {
      isValidMetadata(value) {
        if (typeof value !== 'object' || value === null) {
          throw new Error('Metadata must be a valid JSON object');
        }
      }
    }
  },
  generatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'generated_at'
  },
  validUntil: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'valid_until'
  },
  isActionable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_actionable'
  },
  actionTaken: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'action_taken'
  },
  actionTakenAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'action_taken_at'
  },
  actionTakenBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'action_taken_by',
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'ai_insights',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['user_id']
    },
    {
      fields: ['insight_type']
    },
    {
      fields: ['severity']
    },
    {
      fields: ['generated_at']
    },
    {
      fields: ['score']
    },
    {
      fields: ['is_actionable']
    },
    {
      fields: ['organization_id', 'insight_type', 'generated_at']
    },
    {
      fields: ['user_id', 'insight_type', 'generated_at']
    }
  ]
});

// Instance methods
AiInsight.prototype.isExpired = function() {
  if (!this.validUntil) return false;
  return new Date() > new Date(this.validUntil);
};

AiInsight.prototype.getSeverityLevel = function() {
  const levels = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  return levels[this.severity] || 1;
};

AiInsight.prototype.getRecommendations = function() {
  return this.metadata.recommendations || [];
};

AiInsight.prototype.getDataPoints = function() {
  return this.metadata.dataPoints || [];
};

AiInsight.prototype.markActionTaken = function(takenBy) {
  this.actionTaken = true;
  this.actionTakenAt = new Date();
  this.actionTakenBy = takenBy;
  return this.save();
};

module.exports = AiInsight;