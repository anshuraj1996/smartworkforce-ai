const { Sequelize } = require('sequelize');
require('dotenv').config();
const { resolveSchema } = require('./schema');

// The shared DB server hosts other systems' data (e.g. fpstats) - keep this app's tables
// isolated in their own Postgres schema instead of assuming a dedicated database.
// Required (throws if DB_SCHEMA is missing) - see database/schema.js.
const schema = resolveSchema();

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
      // Makes unqualified table references (raw SQL, a raw FK "REFERENCES organizations")
      // resolve inside our schema. Our schema only - not public: there a missing table of
      // ours could resolve to another product's table of the same name (e.g. users).
      options: `-c search_path=${schema}`
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
      options: `-c search_path=${schema}`
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
      options: `-c search_path=${schema}`,
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
};

const env = process.env.NODE_ENV || 'development';
const sequelize = new Sequelize(config[env].url, config[env]);

// Enables ambient transactions for every query (see database/transaction.js)
const { createWithTransaction } = require('./transaction');
const withTransaction = createWithTransaction(sequelize);

module.exports = {
  sequelize,
  withTransaction,
  schema,
  config: config[env]
};