const { fitRidge } = require('./ridge');

// Forecasts WEEKLY leave demand - leave person-days per employee per week - for the coming
// weeks. Same discipline as attendanceForecast.js (whose daily, weekday-based features don't
// fit a weekly series):
//
//   weekly history -> features (annual seasonality, trend) -> ridge -> backtest vs baseline
//
// Leave is strongly seasonal (summer, festivals, year end), so three Fourier pairs on the
// week of the year carry most of the signal; ridge keeps them from overfitting one year.
// The seasonal-naive baseline is "the same weeks last year" when a year of history exists,
// else the trailing 8-week average. Whichever backtests better forecasts; its backtest errors
// give the p10-p90 range.

const MIN_TRAINING_WEEKS = 26;
const LAMBDAS = [1, 10, 100];
const BACKTEST = { folds: 4, horizon: 4 };
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const toTime = (week) => Date.parse(`${week}T00:00:00Z`);
const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;
const round4 = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

function features(week, origin) {
  const t = toTime(week);
  const yearStart = Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
  const angle = (2 * Math.PI * ((t - yearStart) / DAY_MS)) / 365.25;
  const row = [];
  for (let k = 1; k <= 3; k += 1) row.push(Math.sin(k * angle), Math.cos(k * angle));
  row.push((t - toTime(origin)) / (365 * DAY_MS));
  return row;
}

function ridgeForecaster(train, lambda) {
  const origin = train[0].week;
  const model = fitRidge(train.map(p => features(p.week, origin)), train.map(p => p.value), { lambda });
  return (week) => Math.max(0, model.predict(features(week, origin)));
}

// Same week last year (+/- 1 week, to smooth holidays moving between weeks), else recent mean
function seasonalBaseline(train) {
  const byTime = new Map(train.map(p => [toTime(p.week), p.value]));
  const recent = mean(train.slice(-8).map(p => p.value));
  return (week) => {
    const lastYear = toTime(week) - 52 * WEEK_MS;
    const near = [-1, 0, 1].map(k => byTime.get(lastYear + k * WEEK_MS)).filter(v => v !== undefined);
    return near.length ? mean(near) : recent;
  };
}

function backtest(points, makers) {
  const errors = Object.fromEntries(Object.keys(makers).map(k => [k, []]));
  for (let f = BACKTEST.folds; f >= 1; f -= 1) {
    const cut = points.length - f * BACKTEST.horizon;
    if (cut < MIN_TRAINING_WEEKS) continue;
    const train = points.slice(0, cut);
    const test = points.slice(cut, cut + BACKTEST.horizon);
    for (const [name, make] of Object.entries(makers)) {
      const predict = make(train);
      test.forEach(p => errors[name].push(p.value - predict(p.week)));
    }
  }
  return errors;
}

const mae = (e) => (e.length ? mean(e.map(Math.abs)) : null);

/**
 * points:      [{ week: 'YYYY-MM-DD' (Monday), value }] in order - e.g. leave days per employee
 * futureWeeks: Mondays to forecast
 * Returns null with too little history, else { model, predictions: [{ week, value, low, high }] }.
 */
function forecastWeekly(points, futureWeeks) {
  if (points.length < MIN_TRAINING_WEEKS) return null;

  const makers = { seasonalBaseline };
  LAMBDAS.forEach(l => { makers[`ridge:${l}`] = (train) => ridgeForecaster(train, l); });
  makers.mean = (train) => { const m = mean(train.map(p => p.value)); return () => m; };
  const errors = backtest(points, makers);
  const scores = Object.fromEntries(Object.entries(errors).map(([k, e]) => [k, mae(e)]));
  const tested = scores.seasonalBaseline !== null;

  const bestRidge = LAMBDAS.map(l => `ridge:${l}`).reduce((a, b) => (scores[b] < scores[a] ? b : a));
  const chosen = !tested ? 'ridge:10' : scores[bestRidge] <= scores.seasonalBaseline ? bestRidge : 'seasonalBaseline';
  const predict = makers[chosen](points);
  const residuals = tested ? errors[chosen] : points.map(p => p.value - predict(p.week));
  const lowOffset = quantile(residuals, 0.1);
  const highOffset = quantile(residuals, 0.9);

  return {
    model: {
      type: chosen.startsWith('ridge') ? 'ridge' : 'seasonal-baseline',
      lambda: chosen.startsWith('ridge') ? Number(chosen.split(':')[1]) : null,
      trainingWeeks: points.length,
      backtest: tested ? {
        folds: BACKTEST.folds,
        horizonWeeks: BACKTEST.horizon,
        mae: { model: round4(scores[chosen]), seasonalBaseline: round4(scores.seasonalBaseline), historicalMean: round4(scores.mean) },
        improvementVsMeanPct: scores.mean ? Math.round((1 - scores[chosen] / scores.mean) * 1000) / 10 : null
      } : null
    },
    predictions: futureWeeks.map(week => {
      const value = predict(week);
      return { week, value: round4(value), low: round4(Math.max(0, value + lowOffset)), high: round4(Math.max(0, value + highOffset)) };
    })
  };
}

module.exports = { forecastWeekly, features, MIN_TRAINING_WEEKS };
