// In-memory stand-in for a node-redis v4 client: just the commands utils/cache.js uses.
// Lets tests run the real cache module (prefixes, versions, TTL args) without a Redis server.
const { EventEmitter } = require('events');
const { createCache } = require('../utils/cache');

function fakeRedisClient() {
  const store = new Map();
  const client = new EventEmitter();
  client.store = store;
  client.isOpen = false;
  client.calls = [];

  const record = (name, args) => client.calls.push([name, ...args]);

  client.connect = async () => { client.isOpen = true; client.emit('ready'); };
  client.quit = async () => { client.isOpen = false; client.emit('end'); };
  client.get = async (key) => { record('get', [key]); return store.has(key) ? store.get(key) : null; };
  client.set = async (key, value, options = {}) => {
    record('set', [key, value, options]);
    if (options.NX && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  };
  client.del = async (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    record('del', [list]);
    return list.filter(key => store.delete(key)).length;
  };
  client.incr = async (key) => {
    record('incr', [key]);
    const next = Number(store.get(key) || 0) + 1;
    store.set(key, String(next));
    return next;
  };

  return client;
}

// A connected cache backed by the fake client
async function fakeCache(options = {}) {
  const client = fakeRedisClient();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const cache = createCache({ client, logger, ...options });
  await cache.connectCache();
  return { cache, client, logger };
}

module.exports = { fakeRedisClient, fakeCache };
