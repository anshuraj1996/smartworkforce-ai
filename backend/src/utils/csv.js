// Rows (plain objects) -> CSV text. Columns come from the first row's fields, except nested
// objects/arrays (null is a value, not an object - a column that starts empty is kept).
const isNested = (v) => v !== null && typeof v === 'object' && !(v instanceof Date);

// A cell starting with = + - @ (or tab/CR) is run as a formula by Excel/Sheets ("CSV
// injection") - e.g. an employee named "=HYPERLINK(...)". Prefix such text with ' so it
// stays text. Numbers are left alone, so negative values still work as numbers.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  if (!rows.length) return '';

  const headers = Object.keys(rows[0]).filter(k => !isNested(rows[0][k]));
  return [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n');
}

function sendCsv(res, filename, rows) {
  sendCsvText(res, filename, toCsv(rows));
}

function sendCsvText(res, filename, text) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(text);
}

module.exports = { toCsv, sendCsv, sendCsvText };
