const { AsyncLocalStorage } = require('async_hooks');

// The tenant (organization) the current unit of work belongs to - an API request after
// authentication, or a Kafka event in a worker - available to any code it calls without
// passing it down: logging, and (Phase 2F topic 24) Postgres row-level security, which needs to
// tell the database which organization each query runs for.
//
// Code still passes organizationId explicitly to repositories; this is the ambient copy used
// for cross-cutting concerns, never the only check.
const storage = new AsyncLocalStorage();

// Run fn with { organizationId, userId?, role? } as the current tenant context
function runWithTenant(context, fn) {
  return storage.run(Object.freeze({ ...context }), fn);
}

function currentTenant() {
  return storage.getStore() || null;
}

function currentOrganizationId() {
  const ctx = storage.getStore();
  return ctx ? ctx.organizationId : null;
}

module.exports = { runWithTenant, currentTenant, currentOrganizationId };
