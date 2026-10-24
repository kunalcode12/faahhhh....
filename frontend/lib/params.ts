/**
 * The URL is the source of truth for what the user is looking at, so every
 * view is a shareable, bookmarkable link ("look at 15 Jan at the 09:20 gate").
 *
 * Parsing is defensive: anything malformed or out of range falls back to a
 * sensible default instead of producing an error page.
 */
import { addDays, clampYmd, isYmd } from "./dates";
import type { AccuracyParams, DayAheadParams } from "./api/queries";

/** Mirrors the API's coverage so the first request can fire before /meta returns. */
export const FALLBACK = {
  deliveryFrom: "2026-01-02",
  deliveryTo: "2026-02-01",
  gate: "0950",
  lookback: 14,
  horizon: 24,
  maxHorizon: 48,
  lookbacks: [7, 14, 21, 28],
} as const;

/** Mirrors the API's auction presets for the first paint; /meta replaces them once loaded. */
export const FALLBACK_GATES = [
  { id: "epex-60", label: "EPEX 60-min", gate: "09:20" },
  { id: "n2ex", label: "N2EX", gate: "09:50" },
  { id: "epex-30", label: "EPEX 30-min", gate: "15:30" },
] as const;

export type Coverage = { from: string; to: string };

const GATE = /^([01]\d|2[0-3]):?([0-5]\d)$/;

/** "09:50" or "0950" -> "0950"; anything else -> null. */
export function normaliseGate(value: string | null | undefined): string | null {
  const match = value ? GATE.exec(value) : null;
  return match ? `${match[1]}${match[2]}` : null;
}

/** "0950" -> "09:50" */
export function gateLabel(gate: string): string {
  return `${gate.slice(0, 2)}:${gate.slice(2)}`;
}

function intParam(value: string | null, allowed: (n: number) => boolean, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && allowed(n) ? n : fallback;
}

export function parseDayAhead(search: URLSearchParams, coverage: Coverage): DayAheadParams {
  const rawDate = search.get("date");
  return {
    date: isYmd(rawDate) ? clampYmd(rawDate, coverage.from, coverage.to) : coverage.to,
    gate: normaliseGate(search.get("gate")) ?? FALLBACK.gate,
    lookback: intParam(
      search.get("lookback"),
      (n) => (FALLBACK.lookbacks as readonly number[]).includes(n),
      FALLBACK.lookback,
    ),
  };
}

export function parseAccuracy(search: URLSearchParams, coverage: Coverage): AccuracyParams {
  const rawFrom = search.get("from");
  const rawTo = search.get("to");
  let from = isYmd(rawFrom) ? clampYmd(rawFrom, coverage.from, coverage.to) : coverage.from;
  let to = isYmd(rawTo) ? clampYmd(rawTo, coverage.from, coverage.to) : coverage.to;
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    mode: search.get("mode") === "horizon" ? "horizon" : "gate",
    gate: normaliseGate(search.get("gate")) ?? FALLBACK.gate,
    horizon: intParam(search.get("h"), (n) => n >= 0 && n <= FALLBACK.maxHorizon, FALLBACK.horizon),
    lookback: intParam(
      search.get("lookback"),
      (n) => (FALLBACK.lookbacks as readonly number[]).includes(n),
      FALLBACK.lookback,
    ),
  };
}

export type RangePreset = { id: string; label: string; from: string; to: string };

/** Whole window, then calendar weeks, then the last seven days. */
export function rangePresets(coverage: Coverage): RangePreset[] {
  const presets: RangePreset[] = [{ id: "all", label: "Whole window", ...coverage }];
  let start = coverage.from;
  let week = 1;
  while (addDays(start, 6) <= coverage.to) {
    presets.push({ id: `w${week}`, label: `Week ${week}`, from: start, to: addDays(start, 6) });
    start = addDays(start, 7);
    week += 1;
  }
  presets.push({ id: "last7", label: "Last 7 days", from: addDays(coverage.to, -6), to: coverage.to });
  return presets;
}
