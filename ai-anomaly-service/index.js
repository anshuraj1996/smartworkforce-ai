require('dotenv').config();
const { randomUUID } = require('crypto');
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const ATTENDANCE_TOPIC = 'smartai.attendance.events';
const LOOKBACK_DAYS = 90;
const MIN_SAMPLES = 20;
const ANOMALY_STDDEV_THRESHOLD = 2;
const REDETECT_COOLDOWN_HOURS = 24;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const kafka = new Kafka({
  clientId: 'ai-anomaly-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: { retries: 10, initialRetryTime: 1000 }
});
const consumer = kafka.consumer({ groupId: process.env.KAFKA_CONSUMER_GROUP || 'ai-anomaly-service' });

// Same statistical approach as AnalyticsService.generateAnomalyDetection in the main
// backend, reimplemented independently here since this service owns its own detection
// logic and doesn't share code with the monolith - that's the point of splitting it out.
async function detectAnomaly(userId, organizationId) {
  const { rows } = await pool.query(
    `SELECT date, check_in_time, check_out_time
     FROM "${SCHEMA}"."attendance_logs"
     WHERE user_id = $1
       AND date >= (CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days')
       AND check_in_time IS NOT NULL
       AND check_out_time IS NOT NULL
     ORDER BY date DESC`,
    [userId]
  );

  if (rows.length < MIN_SAMPLES) {
    return null;
  }

  const workHours = rows.map((r) => {
    const checkIn = new Date(`${r.date.toISOString().split('T')[0]} ${r.check_in_time}`);
    const checkOut = new Date(`${r.date.toISOString().split('T')[0]} ${r.check_out_time}`);
    return (checkOut - checkIn) / (1000 * 60 * 60);
  });

  const mean = workHours.reduce((sum, h) => sum + h, 0) / workHours.length;
  const variance = workHours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / workHours.length;
  const stdDev = Math.sqrt(variance);

  const anomalies = workHours.filter((h) => Math.abs(h - mean) > ANOMALY_STDDEV_THRESHOLD * stdDev);
  const anomalyPercentage = (anomalies.length / workHours.length) * 100;
  const stabilityScore = Math.max(0, Math.round(100 - anomalyPercentage * 10 - stdDev * 5));

  if (anomalies.length === 0) {
    return null;
  }

  return {
    organizationId,
    userId,
    stabilityScore,
    avgWorkHours: Math.round(mean * 100) / 100,
    stdDeviation: Math.round(stdDev * 100) / 100,
    anomalyCount: anomalies.length,
    anomalyPercentage: Math.round(anomalyPercentage * 100) / 100,
    sampleSize: workHours.length
  };
}

async function alreadyFlaggedRecently(userId) {
  const { rows } = await pool.query(
    `SELECT id FROM "${SCHEMA}"."ai_insights"
     WHERE user_id = $1 AND insight_type = 'ATTENDANCE_ANOMALY'
       AND generated_at > (NOW() - INTERVAL '${REDETECT_COOLDOWN_HOURS} hours')
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function storeInsight(result) {
  const severity = result.stabilityScore < 40 ? 'HIGH' : result.stabilityScore < 70 ? 'MEDIUM' : 'LOW';
  const title = `Irregular work-hours pattern detected (${result.anomalyCount} anomalous day${result.anomalyCount === 1 ? '' : 's'})`;
  const description = `Over the last ${result.sampleSize} days with full attendance records, work hours averaged ${result.avgWorkHours}h with a standard deviation of ${result.stdDeviation}h. ${result.anomalyCount} day(s) (${result.anomalyPercentage}%) deviated more than ${ANOMALY_STDDEV_THRESHOLD} standard deviations from the average.`;

  await pool.query(
    `INSERT INTO "${SCHEMA}"."ai_insights"
       (id, organization_id, user_id, insight_type, title, description, score, severity, confidence, metadata, generated_at, is_actionable, created_at, updated_at)
     VALUES ($1, $2, $3, 'ATTENDANCE_ANOMALY', $4, $5, $6, $7, $8, $9, NOW(), $10, NOW(), NOW())`,
    [
      randomUUID(),
      result.organizationId,
      result.userId,
      title,
      description,
      result.stabilityScore,
      severity,
      70,
      JSON.stringify({
        avgWorkHours: result.avgWorkHours,
        stdDeviation: result.stdDeviation,
        anomalyCount: result.anomalyCount,
        anomalyPercentage: result.anomalyPercentage,
        sampleSize: result.sampleSize,
        source: 'ai-anomaly-service'
      }),
      severity !== 'LOW'
    ]
  );
}

async function handleAttendanceEvent(payload) {
  if (payload.eventType !== 'CHECKED_OUT') {
    // Only a completed day (check-in + check-out) has enough data for a work-hours anomaly check.
    return;
  }

  const alreadyFlagged = await alreadyFlaggedRecently(payload.userId);
  if (alreadyFlagged) {
    console.log(`[ai-anomaly-service] Skipping user ${payload.userId} - already flagged within the last ${REDETECT_COOLDOWN_HOURS}h`);
    return;
  }

  const result = await detectAnomaly(payload.userId, payload.organizationId);
  if (!result) {
    return;
  }

  await storeInsight(result);
  console.log(`[ai-anomaly-service] Anomaly insight stored for user ${payload.userId} (stability score: ${result.stabilityScore}, ${result.anomalyCount} anomalous days)`);
}

async function main() {
  await pool.query('SELECT 1');
  console.log('[ai-anomaly-service] Database connection established');

  await consumer.connect();
  await consumer.subscribe({ topic: ATTENDANCE_TOPIC, fromBeginning: false });
  console.log(`[ai-anomaly-service] Subscribed to ${ATTENDANCE_TOPIC}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload;
      try {
        payload = JSON.parse(message.value.toString());
      } catch (error) {
        console.error('[ai-anomaly-service] Received malformed event, skipping:', error.message);
        return;
      }

      try {
        await handleAttendanceEvent(payload);
      } catch (error) {
        console.error('[ai-anomaly-service] Error processing event:', error.message);
      }
    }
  });

  console.log('[ai-anomaly-service] Running');
}

async function shutdown() {
  console.log('[ai-anomaly-service] Shutting down...');
  await consumer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error('[ai-anomaly-service] Fatal startup error:', error);
  process.exit(1);
});
