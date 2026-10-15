// Applies pending SQL migrations from src/database/migrations.
//
//   npm run db:migrate
//
// Uses one dedicated pg connection (not the Sequelize pool) because the advisory lock that
// stops two pods migrating at once belongs to a single database session.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { runMigrations } = require('./migrationRunner');
const { resolveSchema } = require('./schema');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function loadMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter(f => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map(name => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

async function migrate() {
  const schema = resolveSchema();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

  await client.connect();
  try {
    // Same schema isolation as the app (database/config.js): our tables live in DB_SCHEMA,
    // and only there - a migration naming a table we don't have fails instead of touching
    // another product's table of the same name in public
    await client.query(`SET search_path TO "${schema}"`);
    console.info(`[migrate] Schema "${schema}"`);
    const applied = await runMigrations({ db: client, migrations: loadMigrations() });
    if (applied.length) {
      console.info(`[migrate] Applied: ${applied.join(', ')}`);
    }
    return applied;
  } finally {
    await client.end();
  }
}

module.exports = { migrate, loadMigrations };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[migrate] Failed:', error.message);
      process.exit(1);
    });
}
