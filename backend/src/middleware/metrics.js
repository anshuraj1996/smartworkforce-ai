// Lightweight in-memory request counters for the system-health/api-usage endpoints.
// Real numbers, just scoped to "since this process started" - there's no metrics
// store (Prometheus, etc.) wired up, and adding one is out of scope for this feature.
let totalRequests = 0;
let errorRequests = 0;
let requestsToday = 0;
let lastResetDate = new Date().toDateString();

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    requestsToday = 0;
    lastResetDate = today;
  }
}

function trackRequests(req, res, next) {
  resetIfNewDay();
  totalRequests += 1;
  requestsToday += 1;

  res.on('finish', () => {
    if (res.statusCode >= 500) errorRequests += 1;
  });

  next();
}

function getMetrics() {
  resetIfNewDay();
  return {
    totalRequests,
    errorRequests,
    requestsToday,
    errorRate: totalRequests ? Math.round((errorRequests / totalRequests) * 10000) / 100 : 0
  };
}

module.exports = { trackRequests, getMetrics };
