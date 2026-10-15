const { createCache } = require('../../utils/cache');
const { fakeRedisClient, fakeCache } = require('../fakeRedis');

describe('cache when Redis is unavailable', () => {
  it('degrades to miss/no-op and never touches the client', async () => {
    const client = fakeRedisClient();
    const cache = createCache({ client, logger: { info: jest.fn(), error: jest.fn() } }); // never connected

    expect(await cache.cacheGet('a')).toBeNull();
    expect(await cache.cacheSet('a', 1, 10)).toBe(false);
    expect(await cache.setIfAbsent('lock', 1, 10)).toBeNull();
    expect(await cache.withCache('a', 10, async () => 'computed')).toBe('computed');
    expect(client.calls).toEqual([]);
  });
});

describe('cache basics', () => {
  it('prefixes every key and round-trips JSON', async () => {
    const { cache, client } = await fakeCache();

    await cache.cacheSet('dashboard:org-1', { present: 3 }, 20);

    expect(client.calls[0]).toEqual(['set', 'smartai:dashboard:org-1', '{"present":3}', { EX: 20 }]);
    expect(await cache.cacheGet('dashboard:org-1')).toEqual({ present: 3 });
  });

  it('cache-aside: computes once, then serves from cache; null results are not cached', async () => {
    const { cache } = await fakeCache();
    const compute = jest.fn().mockResolvedValue({ n: 1 });

    expect(await cache.withCache('k', 30, compute)).toEqual({ n: 1 });
    expect(await cache.withCache('k', 30, compute)).toEqual({ n: 1 });
    expect(compute).toHaveBeenCalledTimes(1);

    const notFound = jest.fn().mockResolvedValue(null);
    await cache.withCache('missing', 30, notFound);
    await cache.withCache('missing', 30, notFound);
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it('deletes many keys in one DEL', async () => {
    const { cache, client } = await fakeCache();
    await cache.cacheSet('a', 1, 10);
    await cache.cacheSet('b', 1, 10);

    expect(await cache.cacheDel(['a', 'b'], 'c')).toBe(2);
    expect(client.calls.filter(c => c[0] === 'del')).toEqual([['del', ['smartai:a', 'smartai:b', 'smartai:c']]]);
  });

  it('setIfAbsent claims a key exactly once', async () => {
    const { cache } = await fakeCache();

    expect(await cache.setIfAbsent('job:x', { at: 1 }, 60)).toBe(true);
    expect(await cache.setIfAbsent('job:x', { at: 2 }, 60)).toBe(false);
  });

  it('tracks hits, misses and hit rate', async () => {
    const { cache } = await fakeCache();
    await cache.cacheSet('a', 1, 10);
    await cache.cacheGet('a');
    await cache.cacheGet('a');
    await cache.cacheGet('nope');

    expect(cache.getStats()).toEqual(expect.objectContaining({ hits: 2, misses: 1, hitRate: 66.7, ready: true }));
  });
});

describe('cache failure handling', () => {
  it('times out a slow Redis instead of slowing the request', async () => {
    const { cache, client } = await fakeCache({ timeoutMs: 20 });
    client.get = () => new Promise(resolve => setTimeout(() => resolve('"late"'), 200));

    const started = Date.now();
    expect(await cache.cacheGet('slow')).toBeNull();
    expect(Date.now() - started).toBeLessThan(150);
    expect(cache.getStats()).toEqual(expect.objectContaining({ timeouts: 1, errors: 1 }));
  });

  it('falls back on command errors and logs at most once a minute', async () => {
    const { cache, client, logger } = await fakeCache();
    client.get = async () => { throw new Error('READONLY'); };

    await cache.cacheGet('a');
    await cache.cacheGet('b');
    await cache.cacheGet('c');

    expect(cache.getStats().errors).toBe(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('stops using Redis when the connection ends', async () => {
    const { cache, client } = await fakeCache();
    client.emit('end');

    expect(cache.isReady()).toBe(false);
    expect(await cache.cacheGet('a')).toBeNull();
  });
});

describe('namespace versioning', () => {
  it('bumping a namespace makes every key in it stale with one INCR', async () => {
    const { cache, client } = await fakeCache();
    let calls = 0;
    const compute = async () => ({ call: ++calls });

    await cache.withVersionedCache('workforce:org-1', 'dashboard:org-1:HR:u1', 20, compute);
    await cache.withVersionedCache('workforce:org-1', 'dashboard:org-1:HR:u1', 20, compute);
    expect(calls).toBe(1);
    expect(client.store.has('smartai:dashboard:org-1:HR:u1:v0')).toBe(true);

    await cache.bumpNamespace('workforce:org-1');
    expect(await cache.withVersionedCache('workforce:org-1', 'dashboard:org-1:HR:u1', 20, compute)).toEqual({ call: 2 });
    expect(client.store.has('smartai:dashboard:org-1:HR:u1:v1')).toBe(true);
  });

  it('namespaces are independent per organization', async () => {
    const { cache } = await fakeCache();
    await cache.bumpNamespace('workforce:org-1');

    expect(await cache.namespaceVersion('workforce:org-1')).toBe(1);
    expect(await cache.namespaceVersion('workforce:org-2')).toBe(0);
  });

  it('cacheDelVersioned removes just the given keys at the current version', async () => {
    const { cache, client } = await fakeCache();
    await cache.bumpNamespace('leave-policy:org-1');
    await cache.withVersionedCache('leave-policy:org-1', 'leave-balance:org-1:u1:2026', 600, async () => [1]);
    await cache.withVersionedCache('leave-policy:org-1', 'leave-balance:org-1:u2:2026', 600, async () => [2]);

    await cache.cacheDelVersioned('leave-policy:org-1', ['leave-balance:org-1:u1:2026']);

    expect(client.store.has('smartai:leave-balance:org-1:u1:2026:v1')).toBe(false);
    expect(client.store.has('smartai:leave-balance:org-1:u2:2026:v1')).toBe(true);
  });
});
