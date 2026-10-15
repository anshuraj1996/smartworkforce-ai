/**
 * Calendar date as YYYY-MM-DD in the user's local timezone.
 *
 * Don't use toISOString() for this: it converts to UTC first, so a date picked in India
 * (local midnight = 18:30 UTC the previous day) comes out one day early.
 */
export function toLocalDateString(value: Date | string = new Date()): string {
  // Already a plain date - parsing it with new Date() would treat it as UTC midnight
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" -> Date at local midnight (new Date('YYYY-MM-DD') would be UTC midnight) */
export function parseLocalDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today's local date as YYYY-MM-DD */
export function todayLocal(): string {
  return toLocalDateString(new Date());
}
