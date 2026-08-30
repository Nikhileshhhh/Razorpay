/**
 * Calendar-aware date/time validation.
 *
 * `Date.parse` normalizes impossible dates (e.g. `2026-02-30` -> March 2), so it
 * cannot be used to reject them. These helpers validate the individual
 * year/month/day/hour/minute/second components and reject any impossible value,
 * leap years included. Pure — no imports.
 */
export const RFC3339_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
export const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const max = daysInMonth[month - 1] ?? 0;
  return day >= 1 && day <= max;
}

function isValidTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/** True only for a real RFC3339 UTC instant (valid calendar date AND time). */
export function isValidRfc3339Utc(value: string): boolean {
  const m = RFC3339_UTC_PATTERN.exec(value);
  if (!m) return false;
  const [, y, mo, d, h, mi, s] = m;
  return (
    isValidCalendarDate(Number(y), Number(mo), Number(d)) &&
    isValidTime(Number(h), Number(mi), Number(s))
  );
}

/** True only for a real `YYYY-MM-DD` calendar date. */
export function isValidDateOnly(value: string): boolean {
  const m = DATE_ONLY_PATTERN.exec(value);
  if (!m) return false;
  return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}
