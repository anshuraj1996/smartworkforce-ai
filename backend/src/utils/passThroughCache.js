// A cache that never caches - the default for services constructed without one (unit tests,
// scripts). Same interface as utils/cache.js, so service code doesn't branch on "is there a cache".
const passThroughCache = {
  cacheGet: async () => null,
  cacheSet: async () => false,
  cacheDel: async () => 0,
  setIfAbsent: async () => null,
  withCache: async (key, ttl, compute) => compute(),
  withVersionedCache: async (namespace, key, ttl, compute) => compute(),
  cacheDelVersioned: async () => 0,
  namespaceVersion: async () => 0,
  bumpNamespace: async () => null
};

module.exports = passThroughCache;
