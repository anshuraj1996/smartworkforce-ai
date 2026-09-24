const { createClient } = require('redis');

// Redis is a cache, not a source of truth - if it's down or slow, every helper here
// degrades to a no-op/miss instead of throwing, so a dead cache never takes the API down.
const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

let ready = false;
let loggedError = false;

client.on('error', (err) => {
  if (!loggedError) {
    console.error('Redis cache error (falling back to no-op cache):', err.message);
    loggedError = true;
  }
  ready = false;
});

client.on('ready', () => {
  ready = true;
  loggedError = false;
  console.log('Redis cache connected');
});

client.connect().catch((err) => {
  console.error('Redis cache connection failed, running without cache:', err.message);
});

async function cacheGet(key) {
  if (!ready) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Cache get error:', error.message);
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  if (!ready) return false;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (error) {
    console.error('Cache set error:', error.message);
    return false;
  }
}

async function cacheDel(key) {
  if (!ready) return false;
  try {
    await client.del(key);
    return true;
  } catch (error) {
    console.error('Cache del error:', error.message);
    return false;
  }
}

// Fetch-or-compute helper: serve the cached value if present, otherwise run
// computeFn, cache its result, and return it.
async function withCache(key, ttlSeconds, computeFn) {
  const cached = await cacheGet(key);
  if (cached !== null) {
    return cached;
  }

  const fresh = await computeFn();
  await cacheSet(key, fresh, ttlSeconds);
  return fresh;
}

function isReady() {
  return ready;
}

module.exports = { cacheGet, cacheSet, cacheDel, withCache, isReady };
