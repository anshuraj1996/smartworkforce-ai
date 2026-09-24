const { Sequelize } = require('sequelize');
require('dotenv').config();

// The shared DB server hosts other systems' data (e.g. fpstats) - keep this app's tables
// isolated in their own Postgres schema instead of assuming a dedicated database.
const schema = process.env.DB_SCHEMA || 'public';

const config = {
  development: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
      schema
    },
    dialectOptions: {
      // Makes unqualified table references (e.g. a raw FK "REFERENCES organizations")
      // resolve inside our schema first, instead of only the qualified CREATE TABLE statements.
      options: `-c search_path=${schema},public`
    }
  },
  test: {
    url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    dialect: 'postgres',
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
      schema
    },
    dialectOptions: {
      options: `-c search_path=${schema},public`
    }
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    logging: false,
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
      schema
    },
    dialectOptions: {
      options: `-c search_path=${schema},public`,
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
};

const env = process.env.NODE_ENV || 'development';
const sequelize = new Sequelize(config[env].url, config[env]);

module.exports = {
  sequelize,
  config: config[env]
};