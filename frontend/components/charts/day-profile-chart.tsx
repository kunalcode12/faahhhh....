"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { DayAhead, DayAheadHour } from "@/lib/api/schemas";
import { ticksFor } from "@/lib/chart-scale";
import { formatAxisGW, formatHours, formatMW, ukDayTime, ukTime } from "@/lib/format";

import { AXIS_LINE, AXIS_TICK, AxisUnit, CHART_MARGIN, COLORS, TooltipCard, TooltipRow } from "./kit";

const HALF_HOUR_MS = 30 * 60_000;
const THREE_HOURS_MS = 3 * 60 * 60_000;

export type DayRow = {
  t: number;
  sp: number;
  actual: number | null;
  forecast: number | null;
  calibrated: number | null;
  band: [number, number] | null;
  /** The forecast hour this half-hour belongs to. Tooltip context only - never plotted. */
  ref: DayAheadHour | null;
};

/**
 * Merge hourly forecasts and half-hourly outturn onto one time axis.
 * Forecast series only carry values at their own (hourly) timestamps; the
 * lines join those points, so nothing is invented for the :30 periods.
 */
export function buildDayRows(day: DayAhead): DayRow[] {
  const byTime = new Map<number, DayRow>();
  const rowAt = (t: number, sp: number) => {
    let row = byTime.get(t);
    if (!row) {
      row = { t, sp, actual: null, forecast: null, calibrated: null, band: null, ref: null };
      byTime.set(t, row);
    }
    return row;
  };
  for (const a of day.actuals) rowAt(Date.parse(a.start_time), a.settlement_period).actual = a.actual_mw;
  for (const h of day.hours) {
    const row = rowAt(Date.parse(h.start_time), h.settlement_period);
    row.forecast = h.forecast_mw;
    row.calibrated = h.calibrated_mw;
    row.band = h.p10_mw !== null && h.p90_mw !== null ? [h.p10_mw, h.p90_mw] : null;
    row.ref = h;
  }
  const rows = [...byTime.values()].sort((a, b) => a.t - b.t);
  let hour: DayAheadHour | null = null;
  for (const row of rows) {
    if (row.ref) hour = row.ref;
    else if (hour && row.t - Date.parse(hour.start_time) < 2 * HALF_HOUR_MS) row.ref = hour;
  }
  return rows;
}

function DayTooltip({ active, payload }: TooltipContentProps) {
  const row = active ? (payload?.[0]?.payload as DayRow | undefined) : undefined;
  if (!row) return null;
  const ref = row.ref;
  const forecastLabel = ref && Date.parse(ref.start_time) !== row.t ? ` (${ukTime(ref.start_time)})` : "";
  return (
    <TooltipCard
      title={`${ukTime(row.t)}–${ukTime(row.t + HALF_HOUR_MS)} · SP ${row.sp}`}
      footer={
        ref ? `Run published ${ukDayTime(ref.published_at)}, ${formatHours(ref.horizon_hours)} ahead` : undefined
      }
    >
      <TooltipRow
        color={COLORS.actual}
        label="Actual"
        value={row.actual === null ? "not metered" : formatMW(row.actual)}
      />
      {ref ? (
        <>
          <TooltipRow color={COLORS.forecast} label={`NESO forecast${forecastLabel}`} value={formatMW(ref.forecast_mw)} />
          {ref.calibrated_mw !== null ? (
            <TooltipRow color={COLORS.calibrated} label="Calibrated" value={formatMW(ref.calibrated_mw)} />
          ) : null}
          {ref.p10_mw !== null && ref.p90_mw !== null ? (
            <TooltipRow
              label="80% range"
              value={`${formatAxisGW(ref.p10_mw)}–${formatAxisGW(ref.p90_mw)} GW`}
            />
          ) : null}
        </>
      ) : null}
    </TooltipCard>
  );
}

export function DayProfileChart({ day, hidden }: { day: DayAhead; hidden: ReadonlySet<string> }) {
  const rows = useMemo(() => buildDayRows(day), [day]);
  const ticks = useMemo(() => {
    if (rows.length === 0) return [];
    const first = rows[0].t;
    const last = rows[rows.length - 1].t;
    const out: number[] = [];
    for (let t = first; t <= last; t += THREE_HOURS_MS) out.push(t);
    return out;
  }, [rows]);
  const yTicks = useMemo(
    () => ticksFor(rows.flatMap((r) => [r.actual, r.forecast, r.band ? r.band[1] : null])),
    [rows],
  );

  return (
    <div>
      <AxisUnit>GW</AxisUnit>
      <div className="h-[340px] sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={COLORS.grid} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={ukTime}
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            ticks={yTicks}
            domain={[yTicks[0], yTicks[yTicks.length - 1]]}
            tickFormatter={formatAxisGW}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            content={(props) => <DayTooltip {...props} />}
            cursor={{ stroke: COLORS.axis, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {!hidden.has("calibrated") ? (
            <Area
              dataKey="band"
              stroke="none"
              fill={COLORS.band}
              fillOpacity={1}
              connectNulls
              activeDot={false}
              isAnimationActive={false}
            />
          ) : null}
          {!hidden.has("calibrated") ? (
            <Line
              dataKey="calibrated"
              stroke={COLORS.calibrated}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4.5, stroke: COLORS.surface, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          {!hidden.has("forecast") ? (
            <Line
              dataKey="forecast"
              stroke={COLORS.forecast}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4.5, stroke: COLORS.surface, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          {!hidden.has("actual") ? (
            <Line
              dataKey="actual"
              stroke={COLORS.actual}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4.5, stroke: COLORS.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
