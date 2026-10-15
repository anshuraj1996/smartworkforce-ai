// npm run db:sync - create any missing tables (sequelize.sync), then apply pending SQL
// migrations. This is what the k8s db-sync Job/CronJob runs.
require('dotenv').config();
const { syncDatabase, closeDatabase } = require('../models');
const { migrate } = require('./migrate');

async function syncAndMigrate() {
  await syncDatabase();
  await migrate();
}

if (require.main === module) {
  syncAndMigrate()
    .then(() => closeDatabase())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[db:sync] Failed:', error.message);
      process.exit(1);
    });
}

module.exports = { syncAndMigrate };
