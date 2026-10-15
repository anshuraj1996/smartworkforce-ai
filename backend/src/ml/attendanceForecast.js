const { fitRidge } = require('./ridge');

// Forecasts a daily RATE (e.g. unplanned absence rate, WFH share) for future working days from
// up to a year of daily history.
//
//   history -> clean -> feature engineering -> ridge regression -> backtest -> forecast + range
//
// Features per day: weekday (one-hot), annual seasonality (two Fourier pairs on day-of-year)
// and a linear trend. Ridge keeps the seasonal terms from overfitting a short history.
//
// The model has to EARN its place: a rolling-origin backtest compares it with a seasonal-naive
// baseline ("same weekday, average of the last 4 weeks"). Whichever has the lower error
// forecasts, and the backtest's own errors give the uncertainty range (p10-p90).

const MIN_TRAINING_DAYS = 40;
const LAMBDAS = [0.3, 3, 30];
const BACKTEST = { folds: 4, horizon: 20 };

const DAY_MS = 24 * 60 * 60 * 1000;
const toTime = (date) => Date.parse(`${date}T00:00:00Z`);
const weekday = (date) => new Date(toTime(date)).getUTCDay();
const dayOfYear = (date) => {
  const t = toTime(date);
  return (t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / DAY_MS;
};
const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

// date -> feature row. `origin` anchors the trend (first training day).
function features(date, origin) {
  const row = [];
  for (let d = 1; d <= 6; d += 1) row.push(weekday(date) === d ? 1 : 0); // Sunday is the base
  const angle = (2 * Math.PI * dayOfYear(date)) / 365.25;
  row.push(Math.sin(angle), Math.cos(angle), Math.sin(2 * angle), Math.cos(2 * angle));
  row.push((toTime(date) - toTime(origin)) / (365 * DAY_MS));
  return row;
}

// ---- the two forecasters ----

function ridgeForecaster(train, lambda) {
  const origin = train[0].date;
  const model = fitRidge(train.map(p => features(p.date, origin)), train.map(p => p.value), { lambda });
  return (date) => clamp01(model.predict(features(date, origin)));
}

// Same weekday over the last 4 weeks of training (falls back to the overall mean)
function weekdayBaseline(train) {
  const recent = train.slice(-40);
  const overall = mean(train.map(p => p.value));
  return (date) => {
    const same = recent.filter(p => weekday(p.date) === weekday(date)).slice(-4);
    return same.length ? mean(same.map(p => p.value)) : overall;
  };
}

/**
 * Rolling-origin backtest: for each fold, train on everything before the cut and predict the
 * next `horizon` points. Returns the absolute and signed errors per forecaster.
 */
function backtest(points, makers, { folds = BACKTEST.folds, horizon = BACKTEST.horizon } = {}) {
  const results = Object.fromEntries(Object.keys(makers).map(k => [k, []]));
  for (let f = folds; f >= 1; f -= 1) {
    const cut = points.length - f * horizon;
    if (cut < MIN_TRAINING_DAYS) continue;
    const train = points.slice(0, cut);
    const test = points.slice(cut, cut + horizon);
    for (const [name, make] of Object.entries(makers)) {
      const predict = make(train);
      test.forEach(p => results[name].push(p.value - predict(p.date)));
    }
  }
  return results;
}

const mae = (errors) => (errors.length ? mean(errors.map(Math.abs)) : null);

/**
 * points:      [{ date: 'YYYY-MM-DD', value: 0..1 }] in date order (working days only)
 * futureDates: dates to forecast
 * Returns null if there's too little history, else { model, predictions }.
 */
function forecastRate(points, futureDates) {
  if (points.length < MIN_TRAINING_DAYS) return null;

  const makers = { weekdayBaseline };
  LAMBDAS.forEach(lambda => { makers[`ridge:${lambda}`] = (train) => ridgeForecaster(train, lambda); });
  makers.mean = (train) => { const m = mean(train.map(p => p.value)); return () => m; };
  const errors = backtest(points, makers);
  const scores = Object.fromEntries(Object.entries(errors).map(([k, e]) => [k, mae(e)]));
  const tested = scores.weekdayBaseline !== null;

  // Best ridge lambda, then ridge vs the baseline. Without enough history for a backtest,
  // ridge with the middle lambda is used and the range falls back to in-sample residuals.
  const bestRidge = LAMBDAS.map(l => `ridge:${l}`).reduce((a, b) => (scores[b] < scores[a] ? b : a));
  const chosen = !tested ? 'ridge:3' : scores[bestRidge] <= scores.weekdayBaseline ? bestRidge : 'weekdayBaseline';
  const predict = makers[chosen](points);

  const residuals = tested ? errors[chosen] : points.map(p => p.value - predict(p.date));
  const lowOffset = quantile(residuals, 0.1);
  const highOffset = quantile(residuals, 0.9);

  return {
    model: {
      type: chosen.startsWith('ridge') ? 'ridge' : 'weekday-baseline',
      lambda: chosen.startsWith('ridge') ? Number(chosen.split(':')[1]) : null,
      trainingDays: points.length,
      backtest: tested ? {
        folds: BACKTEST.folds,
        horizonDays: BACKTEST.horizon,
        mae: {
          model: round4(scores[chosen]),
          weekdayBaseline: round4(scores.weekdayBaseline),
          historicalMean: round4(scores.mean)
        },
        // error reduction vs simply using the historical average
        improvementVsMeanPct: scores.mean ? Math.round((1 - scores[chosen] / scores.mean) * 1000) / 10 : null
      } : null
    },
    predictions: futureDates.map(date => {
      const value = predict(date);
      return { date, value: round4(value), low: round4(clamp01(value + lowOffset)), high: round4(clamp01(value + highOffset)) };
    })
  };
}

const round4 = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);

module.exports = { forecastRate, features, backtest, weekdayBaseline, MIN_TRAINING_DAYS };
