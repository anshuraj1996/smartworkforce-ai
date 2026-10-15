const { createClient } = require('redis');

// The one Redis client for the app and the workers.
//
// Redis is a cache, never a source of truth: if it's down, slow or not connected, every
// helper here degrades to "cache miss / no-op" instead of throwing, so the API keeps working
// (just with more database reads). Two consequences:
// - Importing this module has no side effects; app.js / workers call connectCache() and
//   startup never waits for (or fails on) Redis.
// - Each operation has a short timeout - a slow Redis must not make every request slow.
//
// All keys get a prefix ("smartai:" by default) so the app can share a Redis instance.
// Key names and TTLs live in utils/cacheKeys.js.

const DEFAULT_TIMEOUT_MS = 200;
const ERROR_LOG_INTERVAL_MS = 60 * 1000;

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error(`cache operation timed out after ${ms}ms`), { timeout: true })), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); }
  );
});

function createCache({ client, prefix = 'smartai:', timeoutMs = DEFAULT_TIMEOUT_MS, logger = console }) {
  const stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0, timeouts: 0 };
  let ready = false;
  let lastErrorLogAt = 0;

  // Log at most once a minute - a down Redis would otherwise log on every request
  const logError = (message) => {
    const now = Date.now();
    if (now - lastErrorLogAt > ERROR_LOG_INTERVAL_MS) {
      lastErrorLogAt = now;
      logger.error(`[cache] ${message} (continuing without cache)`);
    }
  };

  client.on('ready', () => {
    ready = true;
    logger.info('[cache] Redis connected');
  });
  client.on('end', () => { ready = false; });
  client.on('error', (error) => {
    ready = false;
    logError(`Redis error: ${error.message}`);
  });

  const k = (key) => `${prefix}${key}`;

  // Run a Redis command, or return `fallback` if Redis is unavailable, slow or errors
  async function safely(operation, fallback) {
    if (!ready) return fallback;
    try {
      return await withTimeout(operation(), timeoutMs);
    } catch (error) {
      stats.errors += 1;
      if (error.timeout) stats.timeouts += 1;
      logError(error.message);
      return fallback;
    }
  }

  async function cacheGet(key) {
    const raw = await safely(() => client.get(k(key)), null);
    if (raw === null || raw === undefined) {
      stats.misses += 1;
      return null;
    }
    stats.hits += 1;
    return JSON.parse(raw);
  }

  async function cacheSet(key, value, ttlSeconds) {
    const ok = await safely(() => client.set(k(key), JSON.stringify(value), { EX: ttlSeconds }), false);
    if (ok) stats.sets += 1;
    return Boolean(ok);
  }

  async function cacheDel(...keys) {
    const list = keys.flat().filter(Boolean);
    if (list.length === 0) return 0;
    const deleted = await safely(() => client.del(list.map(k)), 0);
    stats.deletes += deleted || 0;
    return deleted || 0;
  }

  // Atomic "claim this key" (SET NX EX) for once-only work across replicas.
  // true = claimed, false = someone already holds it, null = Redis unavailable (caller decides).
  async function setIfAbsent(key, value, ttlSeconds) {
    const result = await safely(() => client.set(k(key), JSON.stringify(value), { NX: true, EX: ttlSeconds }), undefined);
    return result === undefined ? null : result === 'OK';
  }

  // Cache-aside: serve the cached value, otherwise compute, store, return.
  // null/undefined results are not cached, so "not found" is always re-checked.
  async function withCache(key, ttlSeconds, compute) {
    const cached = await cacheGet(key);
    if (cached !== null) return cached;

    const fresh = await compute();
    if (fresh !== null && fresh !== undefined) {
      await cacheSet(key, fresh, ttlSeconds);
    }
    return fresh;
  }

  // ---- Namespace versioning: invalidate a whole group of keys with one INCR ----
  //
  // Keys in a namespace embed its current version ("...:v7"). Bumping the version makes every
  // existing key unreachable at once; the orphans simply expire on their TTL. O(1), unlike
  // SCAN+DEL over a key pattern, which gets slower as the keyspace grows.

  async function namespaceVersion(namespace) {
    const version = await safely(() => client.get(k(`ns:${namespace}`)), null);
    return version === null ? 0 : Number(version);
  }

  async function bumpNamespace(namespace) {
    return safely(() => client.incr(k(`ns:${namespace}`)), null);
  }

  const versioned = (key, version) => `${key}:v${version}`;

  async function withVersionedCache(namespace, key, ttlSeconds, compute) {
    const version = await namespaceVersion(namespace);
    return withCache(versioned(key, version), ttlSeconds, compute);
  }

  // Drop specific keys of a namespace (current version) without bumping the whole namespace
  async function cacheDelVersioned(namespace, ...keys) {
    const version = await namespaceVersion(namespace);
    return cacheDel(keys.flat().map(key => versioned(key, version)));
  }

  async function connect() {
    try {
      await client.connect();
    } catch (error) {
      logError(`Redis connection failed: ${error.message}`);
    }
  }

  async function close() {
    if (!client.isOpen) return;
    try {
      await client.quit();
    } catch {
      // already closing
    }
  }

  return {
    cacheGet,
    cacheSet,
    cacheDel,
    setIfAbsent,
    withCache,
    namespaceVersion,
    bumpNamespace,
    withVersionedCache,
    cacheDelVersioned,
    connectCache: connect,
    closeCache: close,
    isReady: () => ready,
    getStats: () => {
      const lookups = stats.hits + stats.misses;
      return { ...stats, ready, hitRate: lookups ? Math.round((stats.hits / lookups) * 1000) / 10 : null };
    }
  };
}

// App-wide instance. disableOfflineQueue: while disconnected, commands fail fast instead of
// piling up in memory; reconnect backs off up to 10s.
const defaultCache = createCache({
  client: createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 500, 10000)
    }
  }),
  prefix: process.env.CACHE_KEY_PREFIX || 'smartai:',
  timeoutMs: Number(process.env.CACHE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
});

module.exports = { ...defaultCache, createCache };
