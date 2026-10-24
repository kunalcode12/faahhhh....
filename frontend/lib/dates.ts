/** Calendar-date helpers for YYYY-MM-DD strings (delivery days), timezone-free. */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

export function isYmd(value: string | null | undefined): value is string {
  if (!value || !YMD.test(value)) return false;
  const date = toUtc(value);
  // Round-trip rejects impossible dates like 2026-02-30.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(ymd: string, days: number): string {
  const date = toUtc(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD strings compare correctly as plain strings. */
export function clampYmd(ymd: string, min: string, max: string): string {
  if (ymd < min) return min;
  if (ymd > max) return max;
  return ymd;
}

export function daysInclusive(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS) + 1;
}
