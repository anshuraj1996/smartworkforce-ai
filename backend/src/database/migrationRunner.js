const crypto = require('crypto');

// Versioned SQL migrations, applied in filename order and recorded in schema_migrations.
//
// Why not just sequelize.sync(): sync can create tables and plain indexes, but it can't drop
// an index, can't build one CONCURRENTLY (it locks writes on the table while it builds), and
// leaves no record of what ran. Migrations are explicit, ordered, and run once.
//
// File rules:
// - Name: NNN_description.sql. Never edit a file after it has been applied anywhere - add a new
//   one instead (a changed checksum on an applied file stops the run).
// - Statements are separated by a ";" at the end of a line (not inside a $$ ... $$ body,
//   so DO blocks and functions work).
// - First line "-- migrate:no-transaction" runs statements one by one outside a transaction.
//   Required for CREATE/DROP INDEX CONCURRENTLY. Otherwise the whole file is one transaction.

const NO_TRANSACTION = /^\s*--\s*migrate:no-transaction/i;
// Fixed key for pg_advisory_lock: only one migration run at a time across all pods/jobs
const LOCK_KEY = 735511001;

const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

// Split on ";" at end of line, drop comment-only/empty chunks. A ";" inside a dollar-quoted
// body ($$ ... $$ or $tag$ ... $tag$ - a DO block or function) doesn't end the statement.
function splitStatements(sql) {
  const statements = [];
  let current = [];
  let openTag = null;

  for (const line of sql.split('\n')) {
    current.push(line);
    for (const tag of line.match(/\$[A-Za-z_]*\$/g) || []) {
      if (openTag === null) openTag = tag;
      else if (tag === openTag) openTag = null;
    }
    if (openTag === null && /;\s*$/.test(line)) {
      statements.push(current.join('\n').replace(/;\s*$/, ''));
      current = [];
    }
  }
  statements.push(current.join('\n'));

  return statements
    .map(s => s.trim())
    .filter(s => s.replace(/--.*$/gm, '').trim().length > 0);
}

async function runMigrations({ db, migrations, logger = console }) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  await db.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const { rows } = await db.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map(r => [r.name, r.checksum]));

    // An applied migration must never change - it may already be live in other environments
    const changed = migrations.filter(m => applied.has(m.name) && applied.get(m.name) !== checksum(m.sql));
    if (changed.length) {
      throw new Error(`Applied migration(s) were modified: ${changed.map(m => m.name).join(', ')} - add a new migration instead`);
    }

    const pending = migrations
      .filter(m => !applied.has(m.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const migration of pending) {
      const statements = splitStatements(migration.sql);
      const outsideTransaction = NO_TRANSACTION.test(migration.sql);
      logger.info(`[migrate] Applying ${migration.name} (${statements.length} statement(s)${outsideTransaction ? ', no transaction' : ''})`);

      if (outsideTransaction) {
        // Each statement must be safe to re-run (IF [NOT] EXISTS), since a failure part-way
        // leaves earlier statements applied and the migration unrecorded
        for (const statement of statements) {
          await db.query(statement);
        }
        await db.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, checksum(migration.sql)]);
      } else {
        await db.query('BEGIN');
        try {
          for (const statement of statements) {
            await db.query(statement);
          }
          await db.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, checksum(migration.sql)]);
          await db.query('COMMIT');
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      }
    }

    if (pending.length === 0) {
      logger.info('[migrate] Database is up to date');
    }
    return pending.map(m => m.name);
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

module.exports = { runMigrations, splitStatements, checksum };
