const { AsyncLocalStorage } = require('async_hooks');
const { Sequelize } = require('sequelize');

// Ambient transactions ("continuation-local storage"): inside withTransaction(fn), every
// Sequelize query - in any repository, however deep - automatically runs in that transaction
// without passing { transaction } through every call. Sequelize looks the current transaction
// up via Sequelize.useCLS(namespace); this namespace is backed by Node's AsyncLocalStorage,
// so no extra dependency is needed.
const storage = new AsyncLocalStorage();

const namespace = {
  run(fn) {
    const context = new Map();
    return storage.run(context, () => fn(context));
  },
  get(key) {
    const context = storage.getStore();
    return context ? context.get(key) : undefined;
  },
  set(key, value) {
    const context = storage.getStore();
    if (context) context.set(key, value);
    return value;
  },
  bind(fn, context = storage.getStore()) {
    return (...args) => (context ? storage.run(context, () => fn(...args)) : fn(...args));
  }
};

Sequelize.useCLS(namespace);

const currentTransaction = () => namespace.get('transaction') || null;

// Run fn in one database transaction: commit if it resolves, roll back if it throws.
// Called inside another withTransaction, it joins the outer one (Sequelize would otherwise
// open a second, independent transaction on another connection).
function createWithTransaction(sequelize) {
  return async function withTransaction(fn) {
    if (currentTransaction()) {
      return fn();
    }
    return sequelize.transaction(() => fn());
  };
}

module.exports = { createWithTransaction, currentTransaction, namespace };
