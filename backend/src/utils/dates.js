// Date/time helpers shared across services. Dates are local calendar dates (YYYY-MM-DD):
// toISOString() converts to UTC first, which shifts the date back a day for any timezone
// ahead of UTC (e.g. Asia/Kolkata between midnight and 05:30).

const pad = (n) => String(n).padStart(2, '0');

function toLocalDateString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  return toLocalDateString(new Date());
}

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toLocalDateString(d);
}

// A date-only value as YYYY-MM-DD, whether it arrived as a string or as the Date that Joi's
// date() produces from a "YYYY-MM-DD" body field. Such Dates are UTC midnight, so the UTC
// calendar date is the one the client sent.
function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// First and last calendar day of a month (month is 1-12)
function monthRange(year, month) {
  return {
    start: toLocalDateString(new Date(year, month - 1, 1)),
    end: toLocalDateString(new Date(year, month, 0))
  };
}

// "09:00" or "09:00:00" -> seconds since midnight. Postgres TIME columns come back as HH:MM:SS.
function timeToSeconds(time) {
  const [h, m, s = 0] = String(time).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function timeToMinutes(time) {
  return Math.floor(timeToSeconds(time) / 60);
}

// Current local time as HH:MM:SS
function nowTimeString() {
  return new Date().toTimeString().split(' ')[0];
}

// An IANA timezone that Intl (and Postgres) accept, else UTC - org settings are user input
function safeTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' });
    return timezone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// YYYY-MM-DD of an instant in the given IANA timezone (the org's local calendar day)
function localDateIn(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

// Calendar arithmetic on YYYY-MM-DD strings. Done in UTC, where every day is 24h, so DST
// can never skip or repeat a date.
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Every date from `from` to `to` inclusive (empty if from > to)
function eachDate(from, to) {
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

module.exports = {
  toLocalDateString,
  todayStr,
  daysAgoStr,
  toDateOnly,
  monthRange,
  timeToSeconds,
  timeToMinutes,
  nowTimeString,
  safeTimezone,
  localDateIn,
  addDays,
  eachDate
};
