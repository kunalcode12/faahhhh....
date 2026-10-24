/**
 * Query definitions: one place that pairs each query key with its fetcher, so
 * components, prefetching and tests can never disagree about either.
 */
import { queryOptions } from "@tanstack/react-query";

import { apiGet } from "./client";
import {
  AccuracySeriesSchema,
  AccuracySummarySchema,
  DayAheadSchema,
  HorizonCurveSchema,
  MetaSchema,
  VintagesSchema,
} from "./schemas";

export type DayAheadParams = { date: string; gate: string; lookback: number };

export type AccuracyParams = {
  from: string;
  to: string;
  mode: "gate" | "horizon";
  gate: string;
  horizon: number;
  lookback: number;
};

/** The API takes HH:MM; the URL keeps the shorter HHMM. */
const apiGate = (gate: string) => (gate.includes(":") ? gate : `${gate.slice(0, 2)}:${gate.slice(2)}`);

export function metaQuery() {
  return queryOptions({
    queryKey: ["meta"],
    queryFn: ({ signal }) => apiGet("/api/v1/meta", {}, MetaSchema, { signal }),
    staleTime: Infinity, // describes the deployment; it does not change while the page is open
  });
}

export function dayAheadQuery(p: DayAheadParams) {
  return queryOptions({
    queryKey: ["day-ahead", p.date, p.gate, p.lookback],
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/day-ahead/${p.date}`,
        { gate: apiGate(p.gate), lookback_days: p.lookback },
        DayAheadSchema,
        { signal },
      ),
  });
}

export function vintagesQuery(p: Pick<DayAheadParams, "date" | "gate">) {
  return queryOptions({
    queryKey: ["vintages", p.date, p.gate],
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/day-ahead/${p.date}/vintages`, { gate: apiGate(p.gate) }, VintagesSchema, {
        signal,
      }),
  });
}

function accuracyParams(p: AccuracyParams) {
  return p.mode === "gate"
    ? { start: p.from, end: p.to, mode: p.mode, gate: apiGate(p.gate), lookback_days: p.lookback }
    : { start: p.from, end: p.to, mode: p.mode, horizon_hours: p.horizon };
}

function accuracyKey(p: AccuracyParams) {
  // Only the parameters that matter for the mode, so switching back and forth hits the cache.
  return p.mode === "gate"
    ? [p.from, p.to, p.mode, p.gate, p.lookback]
    : [p.from, p.to, p.mode, p.horizon];
}

export function accuracySummaryQuery(p: AccuracyParams) {
  return queryOptions({
    queryKey: ["accuracy-summary", ...accuracyKey(p)],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/accuracy/summary", accuracyParams(p), AccuracySummarySchema, { signal }),
  });
}

export function accuracySeriesQuery(p: AccuracyParams) {
  return queryOptions({
    queryKey: ["accuracy-series", ...accuracyKey(p)],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/accuracy/series", accuracyParams(p), AccuracySeriesSchema, { signal }),
  });
}

export function horizonCurveQuery(p: Pick<AccuracyParams, "from" | "to">) {
  return queryOptions({
    queryKey: ["horizons", p.from, p.to],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/accuracy/horizons", { start: p.from, end: p.to }, HorizonCurveSchema, {
        signal,
      }),
  });
}
