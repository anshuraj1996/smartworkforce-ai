const http = require('http');

// Probe endpoints for the worker process (it has no API to probe):
//   GET /livez   200 while the process is up             -> livenessProbe
//   GET /readyz  200 once every consumer joined its group -> readinessProbe
//   GET /stats   per-component counters (processed/failed/...) for debugging
function createHealthServer({ port, components, logger = console }) {
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.url === '/livez') {
      return send(200, { status: 'alive' });
    }

    if (req.url === '/readyz') {
      const notReady = components.filter(c => !c.isReady()).map(c => c.name);
      return send(notReady.length ? 503 : 200, { ready: notReady.length === 0, notReady });
    }

    if (req.url === '/stats') {
      return send(200, Object.fromEntries(components.map(c => [c.name, c.getStats()])));
    }

    return send(404, { error: 'not found' });
  });

  return {
    server,
    start: () => new Promise((resolve) => server.listen(port, () => {
      logger.info(`[workers] Health server on :${server.address().port}`);
      resolve();
    })),
    stop: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

module.exports = { createHealthServer };
