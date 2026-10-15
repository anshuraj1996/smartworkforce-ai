// Which Postgres schema holds this app's tables (DB_SCHEMA).
//
// The database server is shared: e.g. fpstats has another product's tables - including its
// own `users` - in `public`. So there is deliberately no default: a missing DB_SCHEMA must
// stop the app, worker and migrations, not quietly create or query tables in `public`.
// Unit tests never connect, so they get a harmless placeholder.
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function resolveSchema(env = process.env) {
  const schema = env.DB_SCHEMA && env.DB_SCHEMA.trim();

  if (!schema) {
    if (env.NODE_ENV === 'test') return 'smartai_test';
    throw new Error('DB_SCHEMA is not set. Set it to this app\'s Postgres schema (e.g. DB_SCHEMA=smartai) - there is no default because the database is shared.');
  }
  // Interpolated into SQL (search_path, qualified names), so only plain identifiers
  if (!IDENTIFIER.test(schema)) {
    throw new Error(`DB_SCHEMA "${schema}" is not a valid schema name (lowercase letters, digits, underscore)`);
  }
  return schema;
}

// Create the app's schema on a brand-new database, so `db:init` / `db:sync` need no manual
// step. Checks first and only runs CREATE SCHEMA when it's missing: on a shared server the app's
// database user may not have permission to create schemas, and Postgres checks that permission
// even for CREATE SCHEMA IF NOT EXISTS on an existing schema.
// `query(sql, params)` returns rows. Returns true if the schema was created.
async function ensureSchema(query, schema) {
  const rows = await query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
  if (rows.length > 0) return false;
  await query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  return true;
}

module.exports = { resolveSchema, ensureSchema };
