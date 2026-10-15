const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

// A candidate an employee referred for a job opening, tracked through the hiring pipeline
const Referral = sequelize.define('Referral', {
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
  jobOpeningId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'job_opening_id',
    references: {
      model: 'job_openings',
      key: 'id'
    }
  },
  referredBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'referred_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  candidateName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'candidate_name',
    validate: {
      notEmpty: true,
      len: [2, 150]
    }
  },
  candidateEmail: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'candidate_email',
    validate: {
      isEmail: true
    }
  },
  candidatePhone: {
    type: DataTypes.STRING(30),
    allowNull: true,
    field: 'candidate_phone'
  },
  resumeUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'resume_url'
  },
  relationship: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('SUBMITTED', 'SCREENING', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN'),
    allowNull: false,
    defaultValue: 'SUBMITTED'
  },
  statusNote: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'status_note'
  },
  statusUpdatedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'status_updated_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  statusUpdatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'status_updated_at'
  }
}, {
  tableName: 'referrals',
  indexes: [
    {
      fields: ['organization_id', 'status']
    },
    {
      fields: ['job_opening_id']
    },
    {
      fields: ['referred_by']
    },
    {
      fields: ['job_opening_id', 'candidate_email'],
      unique: true
    }
  ]
});

// Allowed pipeline moves. HIRED, REJECTED and WITHDRAWN are final.
Referral.TRANSITIONS = {
  SUBMITTED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['INTERVIEWING', 'REJECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'REJECTED', 'WITHDRAWN'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: []
};

Referral.prototype.canMoveTo = function(nextStatus) {
  return (Referral.TRANSITIONS[this.status] || []).includes(nextStatus);
};

module.exports = Referral;
