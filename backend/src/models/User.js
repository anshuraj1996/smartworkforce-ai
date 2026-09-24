const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
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
      len: [2, 255]
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
      notEmpty: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [6, 255]
    }
  },
  role: {
    type: DataTypes.ENUM('EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'),
    allowNull: false,
    defaultValue: 'EMPLOYEE'
  },
  managerId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'manager_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'employee_id'
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true
  },
  designation: {
    type: DataTypes.STRING,
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  twoFactorEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'two_factor_enabled'
  },
  twoFactorSecret: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'two_factor_secret'
  },
  dateOfBirth: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'date_of_birth'
  },
  hireDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'hire_date'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastLogin: {
    type: DataTypes.DATE,
    field: 'last_login'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'users',
  indexes: [
    {
      fields: ['organization_id']
    },
    {
      fields: ['email']
    },
    {
      fields: ['role']
    },
    {
      fields: ['manager_id']
    },
    {
      fields: ['employee_id', 'organization_id'],
      unique: true
    }
  ],
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        user.password = await bcrypt.hash(user.password, 12);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 12);
      }
    }
  }
});

// Instance methods
User.prototype.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  delete values.password;
  delete values.twoFactorSecret;
  return values;
};

module.exports = User;