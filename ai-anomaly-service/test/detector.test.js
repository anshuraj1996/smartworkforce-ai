const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDayAnomaly, detectPatternShift, normalCdf, quantile } = require('../lib/detector');
const { createSynth } = require('./synthetic');

const ANOMALIES = {
  veryLate: (d) => { d[0] += 150; d[1] += 150; d[3] = Math.max(0, d[0] - 555); return d; },
  shortDay: (d) => { d[2] = 210; d[1] = d[0] + 210; return d; },
  longDay: (d) => { d[2] = 800; d[1] = d[0] + 800; return d; },
  earlyLeave: (d) => { d[1] -= 180; d[2] -= 180; return d; }
};

// Accuracy on synthetic employees - guards against a change that quietly breaks detection
test('day anomalies: high recall on timing anomalies, few false alarms on normal days', () => {
  const { rng, normalDay, employee } = createSynth(42);
  let falseAlarms = 0;
  let normalDays = 0;
  const caught = {};
  const total = 60;

  for (let e = 0; e < total; e += 1) {
    const p = employee();
    const history = Array.from({ length: 20 + Math.floor(rng() * 50) }, () => normalDay(p));
    for (let k = 0; k < 4; k += 1) {
      normalDays += 1;
      if (detectDayAnomaly({ history, day: { date: 'd', values: normalDay(p) }, seed: e * 10 + k })) falseAlarms += 1;
    }
    for (const [name, inject] of Object.entries(ANOMALIES)) {
      if (detectDayAnomaly({ history, day: { date: 'd', values: inject(normalDay(p)) }, seed: e })) caught[name] = (caught[name] || 0) + 1;
    }
  }

  assert.ok(falseAlarms / normalDays <= 0.05, `false-alarm rate ${falseAlarms}/${normalDays}`);
  for (const name of Object.keys(ANOMALIES)) {
    assert.ok((caught[name] || 0) / total >= 0.9, `${name} recall ${caught[name] || 0}/${total}`);
  }
});

test('a flagged day says why, in words, with a model-derived confidence', () => {
  const { normalDay, employee } = createSynth(5);
  const p = { ...employee(), ci: 540, ciSd: 8 };
  const history = Array.from({ length: 60 }, () => normalDay(p));
  const late = normalDay(p);
  late[0] = 700;
  late[1] = 700 + late[2];
  late[3] = 145;

  const finding = detectDayAnomaly({ history, day: { date: '2026-10-08', values: late }, seed: 1 });

  assert.ok(finding);
  assert.equal(finding.date, '2026-10-08');
  assert.ok(finding.anomalyScore > finding.threshold);
  assert.ok(finding.confidence > 50 && finding.confidence <= 100);
  assert.match(finding.reasons.map(r => r.text).join(' '), /checked in at 11:40 \(usually \d\d:\d\d\)/);
});

test('no personal model until there are 20 days of history', () => {
  const { normalDay, employee } = createSynth(9);
  const p = employee();
  const history = Array.from({ length: 19 }, () => normalDay(p));
  assert.equal(detectDayAnomaly({ history, day: { date: 'd', values: [900, 950, 50, 345, 1] }, seed: 1 }), null);
});

test('pattern shift: catches a sustained later check-in and a WFH jump, stays quiet otherwise', () => {
  const { normalDay, employee } = createSynth(11);
  const p = employee();
  const days = (params, n, offset) => Array.from({ length: n }, (_, i) => ({ date: `d${String(offset + i).padStart(3, '0')}`, values: normalDay(params) }));

  assert.equal(detectPatternShift({ days: [...days(p, 40, 0), ...days(p, 10, 100)] }), null);

  const later = detectPatternShift({ days: [...days(p, 40, 0), ...days({ ...p, ci: p.ci + 75 }, 10, 100)] });
  assert.equal(later.shifts[0].feature, 'checkInMinutes');
  assert.match(later.shifts[0].text, /checks in around/);
  assert.ok(later.confidence >= 99);

  const remote = detectPatternShift({ days: [...days(p, 40, 0), ...days({ ...p, wfh: 0.9 }, 10, 100)] });
  assert.ok(remote.shifts.some(s => s.feature === 'wfhShare'));
});

test('helpers', () => {
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-4);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5], 1), 5);
});
