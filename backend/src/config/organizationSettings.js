const Joi = require('joi');

// Per-organization (per-tenant) settings, stored in organizations.settings (JSONB) - no schema
// change: unknown keys already in that column (e.g. defaultShiftStart, requireApproval) are kept
// untouched when settings are updated.
//
// Defaults = the rules every tenant had before settings were configurable, so an organization
// that never touches its settings behaves exactly as before.
const DEFAULT_ORG_SETTINGS = Object.freeze({
  wfhMonthlyQuota: 8,                                            // WFH days per employee per month
  regularizationWindowDays: 30,                                  // how far back attendance can be corrected
  approvalSlaHours: Number(process.env.APPROVAL_SLA_HOURS) || 24, // "decided on time" threshold in analytics
  publicHolidays: []                                             // [{ date: 'YYYY-MM-DD', name }]
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const settingsSchema = Joi.object({
  wfhMonthlyQuota: Joi.number().integer().min(0).max(31),
  regularizationWindowDays: Joi.number().integer().min(1).max(365),
  approvalSlaHours: Joi.number().integer().min(1).max(720),
  publicHolidays: Joi.array().items(Joi.object({
    date: Joi.string().pattern(DATE).required(),
    name: Joi.string().trim().max(100).allow('').default('')
  })).max(100).unique('date')
});

// Older data stored holidays as plain 'YYYY-MM-DD' strings - accept both, return objects
function normalizeHolidays(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(h => (typeof h === 'string' ? { date: h, name: '' } : { date: h && h.date, name: (h && h.name) || '' }))
    .filter(h => typeof h.date === 'string' && DATE.test(h.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Stored JSON -> the effective settings (defaults filled in, holidays normalized)
function effectiveSettings(stored = {}) {
  const s = stored || {};
  const pick = (key) => (s[key] === undefined || s[key] === null ? DEFAULT_ORG_SETTINGS[key] : s[key]);
  return {
    wfhMonthlyQuota: pick('wfhMonthlyQuota'),
    regularizationWindowDays: pick('regularizationWindowDays'),
    approvalSlaHours: pick('approvalSlaHours'),
    publicHolidays: normalizeHolidays(s.publicHolidays)
  };
}

// For services constructed without a settings provider (unit tests, scripts): defaults only
const defaultSettingsProvider = { get: async () => effectiveSettings({}) };

module.exports = { DEFAULT_ORG_SETTINGS, settingsSchema, effectiveSettings, normalizeHolidays, defaultSettingsProvider };
