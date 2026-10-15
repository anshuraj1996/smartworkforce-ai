// Fill daily_kpis with history - run once after deploying 2D (migration 005), or after a
// change to how KPIs are computed.
//
//   npm run kpi:backfill                      # last 90 days, every active organization
//   npm run kpi:backfill -- --days 365
//   npm run kpi:backfill -- --days 30 --org <organizationId>
//
// This only QUEUES the org-days (kpi_refresh_queue); the worker's kpi-refresh job computes
// them, ~200 every 30 seconds. Safe to run again: queueing a day twice is an upsert.
require('dotenv').config();
const { sequelize } = require('../src/models');
const KpiService = require('../src/services/KpiService');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const days = Number(arg('days') || 90);
  if (!Number.isInteger(days) || days < 1 || days > 1095) {
    throw new Error('--days must be a whole number from 1 to 1095');
  }
  const result = await KpiService.backfill({ organizationId: arg('org') || null, days });
  console.info(`[kpi:backfill] Queued ${result.queued} org-days for ${result.organizations} organization(s). The kpi-refresh worker computes them.`);
}

main()
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[kpi:backfill] Failed:', error.message);
    process.exit(1);
  });
