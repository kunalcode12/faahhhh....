"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { AccuracySeries } from "@/lib/api/schemas";
import { ticksFor } from "@/lib/chart-scale";
import { formatAxisGW, formatHours, formatMW, formatSignedPower, ukDayTime } from "@/lib/format";

import { AXIS_LINE, AXIS_TICK, AxisUnit, CHART_MARGIN, COLORS, TooltipCard, TooltipRow } from "./kit";

type ForecastPoint = AccuracySeries["forecasts"][number];
type SeriesRow = { t: number; actual: number | null; forecast: number | null; ref: ForecastPoint | null };

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

const dayTick = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

function buildRows(series: AccuracySeries): SeriesRow[] {
  const byTime = new Map<number, SeriesRow>();
  const rowAt = (t: number) => {
    let row = byTime.get(t);
    if (!row) {
      row = { t, actual: null, forecast: null, ref: null };
      byTime.set(t, row);
    }
    return row;
  };
  for (const a of series.actuals) rowAt(Date.parse(a.start_time)).actual = a.actual_mw;
  for (const f of series.forecasts) {
    const row = rowAt(Date.parse(f.start_time));
    row.forecast = f.forecast_mw;
    row.ref = f;
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function SeriesTooltip({ active, payload }: TooltipContentProps) {
  const row = active ? (payload?.[0]?.payload as SeriesRow | undefined) : undefined;
  if (!row) return null;
  const ref = row.ref;
  return (
    <TooltipCard
      title={ukDayTime(row.t)}
      footer={ref ? `Run ${ukDayTime(ref.published_at)}, ${formatHours(ref.horizon_hours)} ahead` : "Forecasts are hourly"}
    >
      <TooltipRow color={COLORS.actual} label="Actual" value={row.actual === null ? "–" : formatMW(row.actual)} />
      {ref ? (
        <>
          <TooltipRow color={COLORS.forecast} label="NESO forecast" value={formatMW(ref.forecast_mw)} />
          {ref.actual_mw !== null ? (
            <TooltipRow label="Error" value={formatSignedPower(ref.forecast_mw - ref.actual_mw)} />
          ) : null}
        </>
      ) : null}
    </TooltipCard>
  );
}

/** The month at a glance: what the desk was told versus what blew. */
export function SeriesChart({ series }: { series: AccuracySeries }) {
  const rows = useMemo(() => buildRows(series), [series]);
  const ticks = useMemo(() => {
    if (rows.length === 0) return [];
    const first = rows[0].t;
    const last = rows[rows.length - 1].t;
    const days = Math.max(1, Math.round((last - first) / DAY_MS));
    const step = days <= 8 ? 1 : days <= 16 ? 2 : 4;
    const out: number[] = [];
    for (let t = first; t <= last; t += step * DAY_MS) out.push(t);
    return out;
  }, [rows]);
  const yTicks = useMemo(() => ticksFor(rows.flatMap((r) => [r.actual, r.forecast])), [rows]);

  return (
    <div>
      <AxisUnit>GW</AxisUnit>
      <div className="h-[320px] sm:h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={COLORS.grid} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={(t: number) => dayTick.format(t)}
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
            content={(props) => <SeriesTooltip {...props} />}
            cursor={{ stroke: COLORS.axis, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="forecast"
            stroke={COLORS.forecast}
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 4, stroke: COLORS.surface, strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="actual"
            stroke={COLORS.actual}
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 4, stroke: COLORS.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
