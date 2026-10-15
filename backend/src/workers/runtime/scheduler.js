const cron = require('node-cron');

// A periodic job. Runs once at startup (so a worker that was down at the scheduled time
// catches up) and then on the cron schedule. Overlapping runs are skipped: if one run is
// still going when the next tick fires, the tick is dropped rather than run twice.
//
// "Run once across replicas" is NOT handled here - the job itself claims per-unit locks
// (see jobs/birthdayJob.js), which also makes restarts and catch-up runs safe.
function createScheduledJob({ name, schedule, run, logger = console, runOnStart = true }) {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule for ${name}: ${schedule}`);
  }

  const stats = { runs: 0, failures: 0, skippedOverlaps: 0, lastRunAt: null, lastResult: null };
  let task = null;
  let running = false;

  async function runOnce() {
    if (running) {
      stats.skippedOverlaps += 1;
      return null;
    }

    running = true;
    try {
      const result = await run();
      stats.runs += 1;
      stats.lastResult = result;
      return result;
    } catch (error) {
      stats.failures += 1;
      logger.error(`[${name}] run failed: ${error.message}`);
      return null;
    } finally {
      running = false;
      stats.lastRunAt = new Date().toISOString();
    }
  }

  async function start() {
    task = cron.schedule(schedule, runOnce);
    logger.info(`[${name}] Scheduled (${schedule})`);
    if (runOnStart) {
      await runOnce();
    }
  }

  async function stop() {
    if (task) task.stop();
  }

  return {
    name,
    start,
    stop,
    runOnce,
    isReady: () => true,
    getStats: () => ({ ...stats, running })
  };
}

module.exports = { createScheduledJob };
