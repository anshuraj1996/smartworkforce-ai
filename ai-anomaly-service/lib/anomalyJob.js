const { randomUUID } = require('crypto');
const { dayFeatures } = require('./features');
const { detectDayAnomaly, detectPatternShift } = require('./detector');
const { hashSeed } = require('./isolationForest');

const LOOKBACK_DAYS = 90;
const SHIFT_REALERT_DAYS = 7; // a sustained change stays visible for a while - don't re-alert daily
const MODEL_VERSION = 'isolation-forest-v1';

// What happens when an employee checks out (their day is complete):
//  1. load their last 90 days of completed attendance
//  2. day anomaly: Isolation Forest over this employee's own history - is TODAY unusual?
//  3. pattern shift: are the last 10 days different from before (later check-ins, shorter
//     days, much more WFH)?
//  4. store each finding as an ai_insights row - at most one per employee per day (anomaly)
//     and one per week (shift), so a redelivered event never duplicates an insight.
// `query(sql, params)` is pg's pool.query - injected so this runs in tests without a database.
function createAnomalyJob({ query, schema, newId = randomUUID, logger = console }) {
  const table = (name) => `"${schema}"."${name}"`;

  async function loadDays(organizationId, userId) {
    const { rows } = await query(
      `SELECT date::text AS date, check_in_time, check_out_time, working_minutes, late_minutes, attendance_type
       FROM ${table('attendance_logs')}
       WHERE organization_id = $1 AND user_id = $2
         AND date >= CURRENT_DATE - ${LOOKBACK_DAYS}
         AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
       ORDER BY date`,
      [organizationId, userId]
    );
    return rows.map(dayFeatures).filter(Boolean);
  }

  async function exists(sql, params) {
    const { rows } = await query(sql, params);
    return rows.length > 0;
  }

  async function store({ organizationId, userId, insightType, title, description, score, severity, confidence, metadata }) {
    await query(
      `INSERT INTO ${table('ai_insights')}
         (id, organization_id, user_id, insight_type, title, description, score, severity, confidence, metadata,
          generated_at, is_actionable, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, NOW(), NOW())`,
      [newId(), organizationId, userId, insightType, title, description, score, severity, confidence,
        JSON.stringify(metadata), severity !== 'LOW']
    );
  }

  async function checkDay({ organizationId, userId, day, history }) {
    const stored = await exists(
      `SELECT 1 FROM ${table('ai_insights')}
       WHERE user_id = $1 AND insight_type = 'ATTENDANCE_ANOMALY'
         AND metadata->>'detector' = 'isolation-forest' AND metadata->>'date' = $2
       LIMIT 1`,
      [userId, day.date]
    );
    if (stored) return null;

    // Seeded by employee + day: re-scoring the same day always gives the same answer
    const finding = detectDayAnomaly({ history: history.map(d => d.values), day, seed: hashSeed(`${userId}:${day.date}`) });
    if (!finding) return null;

    await store({
      organizationId,
      userId,
      insightType: 'ATTENDANCE_ANOMALY',
      title: `Unusual attendance on ${finding.date}`,
      description: `Compared with ${finding.sampleSize} earlier days: ${finding.reasons.map(r => r.text).join('; ')}.`,
      score: Math.round(finding.anomalyScore * 100),
      severity: finding.severity,
      confidence: finding.confidence,
      metadata: {
        detector: 'isolation-forest',
        model: MODEL_VERSION,
        source: 'ai-anomaly-service',
        scoreMeaning: 'Isolation Forest anomaly score x 100 (50 = typical day, higher = more unusual)',
        ...finding
      }
    });
    return finding;
  }

  async function checkShift({ organizationId, userId, days }) {
    const recent = await exists(
      `SELECT 1 FROM ${table('ai_insights')}
       WHERE user_id = $1 AND insight_type = 'BEHAVIORAL_PATTERN'
         AND metadata->>'detector' = 'pattern-shift'
         AND generated_at > NOW() - INTERVAL '${SHIFT_REALERT_DAYS} days'
       LIMIT 1`,
      [userId]
    );
    if (recent) return null;

    const shift = detectPatternShift({ days });
    if (!shift) return null;

    const strongest = Math.max(...shift.shifts.map(s => Math.abs(s.z)));
    await store({
      organizationId,
      userId,
      insightType: 'BEHAVIORAL_PATTERN',
      title: 'Attendance pattern changed',
      description: `Last ${shift.recentDays} days compared with the ${shift.baselineDays} before: ${shift.shifts.map(s => s.text).join('; ')}.`,
      score: Math.min(100, Math.round(strongest * 10)),
      severity: shift.severity,
      confidence: shift.confidence,
      metadata: {
        detector: 'pattern-shift',
        source: 'ai-anomaly-service',
        scoreMeaning: 'strongest shift test statistic |z| x 10, capped at 100',
        ...shift
      }
    });
    return shift;
  }

  // ATTENDANCE_CHECKED_OUT -> both detectors for that employee and day
  async function handleCheckOut(event) {
    const { userId } = event.data;
    const organizationId = event.organizationId;
    const days = await loadDays(organizationId, userId);
    if (days.length === 0) return { skipped: 'no completed days' };

    // v1 events carry the day; legacy messages may not - then it's their latest completed day
    const date = event.data.date || days[days.length - 1].date;
    const day = days.find(d => d.date === date);
    if (!day) return { skipped: `no completed attendance for ${date}` };

    const anomaly = await checkDay({ organizationId, userId, day, history: days.filter(d => d.date < date) });
    const shift = await checkShift({ organizationId, userId, days: days.filter(d => d.date <= date) });
    if (anomaly) logger.info(`[ai-anomaly-service] ${userId} ${date}: anomaly score ${anomaly.anomalyScore} (${anomaly.reasons.map(r => r.feature).join(', ')})`);
    if (shift) logger.info(`[ai-anomaly-service] ${userId}: pattern shift (${shift.shifts.map(s => s.feature).join(', ')})`);
    return { anomaly, shift };
  }

  return { handleCheckOut, loadDays };
}

// Worth a Kafka retry (the database is briefly unreachable) vs a bad message / bug (log, move on)
function isTransientError(error) {
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error.code)
    || /^(08|57P0)/.test(error.code || ''); // Postgres connection exceptions / admin shutdown
}

module.exports = { createAnomalyJob, isTransientError, MODEL_VERSION };
