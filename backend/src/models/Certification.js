const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const Certification = sequelize.define('Certification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
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
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { notEmpty: true }
  },
  provider: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { notEmpty: true }
  },
  dateObtained: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'date_obtained'
  },
  expiryDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'expiry_date'
  },
  certificateUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'certificate_url'
  }
}, {
  tableName: 'certifications',
  indexes: [
    { fields: ['user_id'] }
  ]
});

module.exports = Certification;
