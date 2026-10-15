const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnomalyJob, isTransientError } = require('../lib/anomalyJob');
const { dayFeatures, toMinutes } = require('../lib/features');

const pad = (n) => String(n).padStart(2, '0');
const time = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(Math.round(minutes % 60))}:00`;

// 40 regular days (Aug 1 - Sep 9), then a very late, short day on the event's date
function attendanceRows() {
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const d = new Date(Date.UTC(2026, 7, 1 + i));
    const ci = 540 + ((i * 7) % 11) - 5;
    const wm = 510 + ((i * 5) % 21) - 10;
    rows.push({
      date: d.toISOString().slice(0, 10), check_in_time: time(ci), check_out_time: time(ci + wm),
      working_minutes: wm, late_minutes: 0, attendance_type: 'PRESENT'
    });
  }
  rows.push({ date: '2026-10-08', check_in_time: '11:45:00', check_out_time: '15:00:00', working_minutes: 195, late_minutes: 150, attendance_type: 'LATE' });
  return rows;
}

function fakeDb({ stored = [] } = {}) {
  const inserts = [];
  const query = async (sql, params) => {
    if (sql.includes('FROM "smartai"."attendance_logs"')) return { rows: attendanceRows() };
    if (sql.startsWith('SELECT 1')) {
      const detector = sql.includes("'pattern-shift'") ? 'pattern-shift' : 'isolation-forest';
      return { rows: stored.filter(s => s.detector === detector && (detector === 'pattern-shift' || s.date === params[1])) };
    }
    if (sql.includes('INSERT INTO "smartai"."ai_insights"')) {
      inserts.push(params);
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { query, inserts };
}

const event = { organizationId: 'org-1', data: { userId: 'u-1', date: '2026-10-08' } };
const quiet = { info() {} };

test('a very late, short day is stored as an explained ATTENDANCE_ANOMALY insight', async () => {
  const db = fakeDb();
  const job = createAnomalyJob({ query: db.query, schema: 'smartai', newId: () => 'id-1', logger: quiet });

  const { anomaly } = await job.handleCheckOut(event);

  assert.ok(anomaly);
  const insight = db.inserts.find(p => p[3] === 'ATTENDANCE_ANOMALY');
  assert.ok(insight, 'insight stored');
  const [id, org, user, , title, description, score, severity, confidence, metadata, actionable] = insight;
  assert.deepEqual([id, org, user, title], ['id-1', 'org-1', 'u-1', 'Unusual attendance on 2026-10-08']);
  assert.match(description, /checked in at 11:45/);
  assert.ok(score > 50 && score <= 100);
  assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(severity));
  assert.ok(confidence > 0);
  assert.equal(actionable, severity !== 'LOW');
  const meta = JSON.parse(metadata);
  assert.equal(meta.detector, 'isolation-forest');
  assert.equal(meta.date, '2026-10-08');
  assert.equal(meta.sampleSize, 40); // the model never trains on the day it judges
});

test('a redelivered event does not store the same day twice', async () => {
  const db = fakeDb({ stored: [{ detector: 'isolation-forest', date: '2026-10-08' }, { detector: 'pattern-shift' }] });
  const job = createAnomalyJob({ query: db.query, schema: 'smartai', logger: quiet });

  const result = await job.handleCheckOut(event);

  assert.deepEqual(result, { anomaly: null, shift: null });
  assert.equal(db.inserts.length, 0);
});

test('an event for a day without a completed record is skipped', async () => {
  const db = fakeDb();
  const job = createAnomalyJob({ query: db.query, schema: 'smartai', logger: quiet });

  assert.deepEqual(
    await job.handleCheckOut({ ...event, data: { userId: 'u-1', date: '2026-10-09' } }),
    { skipped: 'no completed attendance for 2026-10-09' }
  );
});

test('features and error classification', () => {
  assert.equal(toMinutes('09:30:30'), 570.5);
  assert.equal(toMinutes(null), null);
  assert.deepEqual(
    dayFeatures({ date: '2026-10-08', check_in_time: '09:00', check_out_time: '17:30', working_minutes: null, late_minutes: null, attendance_type: 'WORK_FROM_HOME' }).values,
    [540, 1050, 510, 0, 1]
  );
  assert.equal(dayFeatures({ date: '2026-10-08', check_in_time: '09:00', check_out_time: null }), null);
  assert.equal(isTransientError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isTransientError({ code: '57P01' }), true);
  assert.equal(isTransientError({ code: '22P02' }), false);
});
