const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

// An open position HR is hiring for. Employees can refer candidates while it's OPEN.
const JobOpening = sequelize.define('JobOpening', {
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
  department: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  location: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  employmentType: {
    type: DataTypes.ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'),
    allowNull: false,
    defaultValue: 'FULL_TIME',
    field: 'employment_type'
  },
  experienceMin: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'experience_min'
  },
  experienceMax: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'experience_max'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  openings: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: {
      min: 1
    }
  },
  referralBonus: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'referral_bonus'
  },
  status: {
    type: DataTypes.ENUM('OPEN', 'ON_HOLD', 'CLOSED'),
    allowNull: false,
    defaultValue: 'OPEN'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'created_by',
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'job_openings',
  indexes: [
    {
      fields: ['organization_id', 'status']
    },
    {
      fields: ['department']
    }
  ],
  validate: {
    experienceRange() {
      if (this.experienceMin != null && this.experienceMax != null && this.experienceMax < this.experienceMin) {
        throw new Error('Maximum experience must be greater than or equal to minimum experience');
      }
    }
  }
});

module.exports = JobOpening;
