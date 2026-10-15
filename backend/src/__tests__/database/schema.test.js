const { resolveSchema, ensureSchema } = require('../../database/schema');

describe('resolveSchema (DB_SCHEMA is required - the database is shared)', () => {
  it('uses DB_SCHEMA', () => {
    expect(resolveSchema({ DB_SCHEMA: 'smartai', NODE_ENV: 'production' })).toBe('smartai');
    expect(resolveSchema({ DB_SCHEMA: ' smartai ' })).toBe('smartai');
  });

  it('refuses to start without it, instead of defaulting to public', () => {
    expect(() => resolveSchema({ NODE_ENV: 'production' })).toThrow('DB_SCHEMA is not set');
    expect(() => resolveSchema({ DB_SCHEMA: '  ', NODE_ENV: 'development' })).toThrow('DB_SCHEMA is not set');
  });

  it('rejects anything that is not a plain identifier (it is interpolated into SQL)', () => {
    for (const bad of ['smartai"; DROP TABLE users; --', 'smart-ai', 'Smartai', '1smartai', 'a'.repeat(64)]) {
      expect(() => resolveSchema({ DB_SCHEMA: bad })).toThrow('not a valid schema name');
    }
  });

  it('unit tests (which never connect) get a placeholder, never public', () => {
    expect(resolveSchema({ NODE_ENV: 'test' })).toBe('smartai_test');
  });
});

describe('ensureSchema (fresh install needs no manual CREATE SCHEMA)', () => {
  it('creates the schema only when it is missing', async () => {
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    expect(await ensureSchema(query, 'smartai')).toBe(true);
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT 1 FROM pg_namespace WHERE nspname = $1', ['smartai']);
    expect(query).toHaveBeenNthCalledWith(2, 'CREATE SCHEMA IF NOT EXISTS "smartai"');
  });

  it('never runs CREATE SCHEMA when it exists (the DB user may lack that permission)', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    expect(await ensureSchema(query, 'smartai')).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
