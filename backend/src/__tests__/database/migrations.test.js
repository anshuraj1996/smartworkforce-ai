const { runMigrations, splitStatements, checksum } = require('../../database/migrationRunner');
const { loadMigrations } = require('../../database/migrate');

const quietLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// Records every query; schema_migrations lookups return `applied`
const fakeDb = (applied = [], { failOn } = {}) => {
  const queries = [];
  return {
    queries,
    sqlRun: () => queries.map(q => q.sql.trim()),
    async query(sql, params) {
      queries.push({ sql, params });
      if (failOn && sql.includes(failOn)) throw new Error(`boom: ${failOn}`);
      if (sql.startsWith('SELECT name, checksum FROM schema_migrations')) {
        return { rows: applied.map(m => ({ name: m.name, checksum: checksum(m.sql) })) };
      }
      return { rows: [] };
    }
  };
};

const txMigration = { name: '010_add_table.sql', sql: 'CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n' };
const concurrentMigration = { name: '011_index.sql', sql: '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY i ON a (id);\n' };

describe('runMigrations', () => {
  it('applies pending migrations in name order and records each one', async () => {
    const db = fakeDb();

    const applied = await runMigrations({ db, migrations: [concurrentMigration, txMigration], logger: quietLogger });

    expect(applied).toEqual(['010_add_table.sql', '011_index.sql']);
    const inserts = db.queries.filter(q => q.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map(q => q.params[0])).toEqual(['010_add_table.sql', '011_index.sql']);
  });

  it('wraps a normal migration in a transaction, but not a no-transaction one', async () => {
    const db = fakeDb();

    await runMigrations({ db, migrations: [txMigration, concurrentMigration], logger: quietLogger });

    const sql = db.sqlRun();
    const begin = sql.indexOf('BEGIN');
    expect(sql.slice(begin, begin + 5)).toEqual([
      'BEGIN', 'CREATE TABLE a (id int)', 'CREATE TABLE b (id int)', expect.stringContaining('INSERT INTO schema_migrations'), 'COMMIT'
    ]);
    expect(sql.filter(s => s === 'BEGIN')).toHaveLength(1);
    expect(sql).toContainEqual(expect.stringContaining('CREATE INDEX CONCURRENTLY i ON a (id)'));
  });

  it('skips migrations already applied', async () => {
    const db = fakeDb([txMigration]);

    expect(await runMigrations({ db, migrations: [txMigration], logger: quietLogger })).toEqual([]);
    expect(db.sqlRun()).not.toContain('CREATE TABLE a (id int)');
  });

  it('refuses to run when an applied migration file was edited', async () => {
    const db = fakeDb([txMigration]);
    const edited = { ...txMigration, sql: txMigration.sql + 'CREATE TABLE c (id int);\n' };

    await expect(runMigrations({ db, migrations: [edited], logger: quietLogger })).rejects.toThrow('were modified: 010_add_table.sql');
  });

  it('rolls back a failed transactional migration and does not record it', async () => {
    const db = fakeDb([], { failOn: 'CREATE TABLE b' });

    await expect(runMigrations({ db, migrations: [txMigration], logger: quietLogger })).rejects.toThrow('boom');

    const sql = db.sqlRun();
    expect(sql).toContain('ROLLBACK');
    expect(sql.some(s => s.startsWith('INSERT INTO schema_migrations'))).toBe(false);
  });

  it('holds an advisory lock for the whole run and releases it even on failure', async () => {
    const db = fakeDb([], { failOn: 'CREATE TABLE b' });

    await expect(runMigrations({ db, migrations: [txMigration], logger: quietLogger })).rejects.toThrow();

    const sql = db.sqlRun();
    expect(sql.findIndex(s => s.startsWith('SELECT pg_advisory_lock'))).toBeLessThan(sql.indexOf('BEGIN'));
    expect(sql[sql.length - 1]).toMatch(/^SELECT pg_advisory_unlock/);
  });
});

describe('splitStatements', () => {
  it('splits on line-ending semicolons and drops comment-only chunks', () => {
    const sql = '-- header\n-- more\nCREATE INDEX a ON t (x);\n\n-- note\nDROP INDEX b;\n-- trailing comment\n';
    expect(splitStatements(sql)).toEqual(['-- header\n-- more\nCREATE INDEX a ON t (x)', '-- note\nDROP INDEX b']);
  });

  it('keeps a DO block / function body ($$ ... $$) together despite its inner semicolons', () => {
    const sql = [
      'CREATE TABLE a (id int);',
      'DO $$',
      'DECLARE r record;',
      'BEGIN',
      "  RAISE NOTICE 'one';",
      'END $$;',
      'CREATE FUNCTION f() RETURNS int AS $fn$',
      '  SELECT 1;',
      '$fn$ LANGUAGE sql;',
      'DROP TABLE b;'
    ].join('\n');
    expect(splitStatements(sql)).toEqual([
      'CREATE TABLE a (id int)',
      "DO $$\nDECLARE r record;\nBEGIN\n  RAISE NOTICE 'one';\nEND $$",
      'CREATE FUNCTION f() RETURNS int AS $fn$\n  SELECT 1;\n$fn$ LANGUAGE sql',
      'DROP TABLE b'
    ]);
  });

  it('bind parameters like $1 are not mistaken for dollar quotes', () => {
    expect(splitStatements('SELECT $1;\nSELECT $2;')).toEqual(['SELECT $1', 'SELECT $2']);
  });
});

describe('the real migration files', () => {
  const migrations = loadMigrations();

  it('are numbered, unique and parse into statements', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    migrations.forEach(m => expect(splitStatements(m.sql).length).toBeGreaterThan(0));
    expect(new Set(migrations.map(m => m.name.split('_')[0])).size).toBe(migrations.length);
  });

  it('only use CONCURRENTLY inside no-transaction migrations (Postgres rejects it in a transaction)', () => {
    migrations
      .filter(m => /CONCURRENTLY/i.test(m.sql))
      .forEach(m => expect(m.sql).toMatch(/^\s*--\s*migrate:no-transaction/i));
  });

  // A failed CONCURRENTLY build leaves an INVALID index behind; dropping first makes re-runs repair it
  it('drop each concurrently-created index first so a failed run can be re-run', () => {
    migrations.forEach(m => {
      const created = [...m.sql.matchAll(/CREATE (?:UNIQUE )?INDEX CONCURRENTLY (\w+)/gi)].map(x => x[1]);
      created.forEach(name => expect(m.sql).toMatch(new RegExp(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`)));
    });
  });

  // If a model still declared a dropped index, sequelize.sync() would quietly recreate it
  it('drop no index that a model still declares', () => {
    const models = require('../../models');
    const declared = new Set();
    Object.values(models)
      .filter(m => m && m.options && Array.isArray(m.options.indexes))
      .forEach(m => m.options.indexes.forEach(ix => declared.add(ix.name || `${m.getTableName().tableName || m.getTableName()}_${ix.fields.join('_')}`)));

    const dropped = migrations.flatMap(m => [...m.sql.matchAll(/DROP INDEX CONCURRENTLY IF EXISTS (\w+);/gi)].map(x => x[1]));
    const recreatedBySync = dropped.filter(name => declared.has(name) && !/^(idx_|uq_)/.test(name));

    expect(recreatedBySync).toEqual([]);
  });
});
