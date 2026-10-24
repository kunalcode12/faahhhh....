"use client";

/*
 * The breakdown charts on the accuracy page. Each answers one question:
 *   LeadTimeChart  - how much worse is a forecast made further ahead?
 *   HourOfDayChart - when in the day are the misses biggest?
 *   LevelBiasChart - does the forecast over-promise more when it's windy?
 *   ErrorHistogram - which way does it miss, and how far?
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { AccuracySummary, HorizonCurve } from "@/lib/api/schemas";
import { ticksFor } from "@/lib/chart-scale";
import { formatAxisGW, formatMW, formatPct, formatSignedPower } from "@/lib/format";

import { AXIS_LINE, AXIS_TICK, AxisUnit, CHART_MARGIN, COLORS, TooltipCard, TooltipRow } from "./kit";

const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const PLOT = "h-[260px]";

function rowOf<T>(active: boolean, payload: TooltipContentProps["payload"]): T | undefined {
  return active ? (payload?.[0]?.payload as T | undefined) : undefined;
}

function yAxisProps(ticks: number[], format?: (value: number) => string) {
  return {
    ticks,
    domain: [ticks[0], ticks[ticks.length - 1]] as [number, number],
    tickFormatter: format,
    tick: AXIS_TICK,
    axisLine: false,
    tickLine: false,
    width: 40,
  };
}

// --- lead time ----------------------------------------------------------------------

type LeadRow = HorizonCurve["buckets"][number];

function LeadTooltip({ active, payload }: TooltipContentProps) {
  const row = rowOf<LeadRow>(active, payload);
  if (!row) return null;
  return (
    <TooltipCard
      title={`Published ${row.horizon_hours}–${row.horizon_hours + 1} h ahead`}
      footer={`${row.count} forecasts scored`}
    >
      <TooltipRow color={COLORS.forecast} label="Mean abs. error" value={formatMW(row.mae_mw)} />
      <TooltipRow color={COLORS.deemph} label="1-in-10 miss" value={formatMW(row.p90_abs_mw)} />
      <TooltipRow label="Bias" value={formatSignedPower(row.bias_mw)} />
    </TooltipCard>
  );
}

export function LeadTimeChart({ curve, window }: { curve: HorizonCurve; window: [number, number] | null }) {
  const ticks = ticksFor(curve.buckets.map((b) => b.p90_abs_mw), { count: 4 });
  return (
    <div>
      <AxisUnit>GW</AxisUnit>
      <div className={PLOT}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={curve.buckets} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            {window ? (
              <ReferenceArea
                x1={Math.floor(window[0])}
                x2={Math.floor(window[1])}
                fill={COLORS.grid}
                fillOpacity={0.6}
                label={{ value: "your day-ahead bids", position: "insideTop", fill: COLORS.muted, fontSize: 12 }}
              />
            ) : null}
            <XAxis
              dataKey="horizon_hours"
              type="number"
              domain={[0, 48]}
              ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
              tickFormatter={(h: number) => `${h}h`}
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={false}
            />
            <YAxis {...yAxisProps(ticks, formatAxisGW)} />
            <Tooltip content={(props) => <LeadTooltip {...props} />} cursor={{ stroke: COLORS.axis }} isAnimationActive={false} />
            <Line dataKey="p90_abs_mw" stroke={COLORS.deemph} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              dataKey="mae_mw"
              stroke={COLORS.forecast}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4.5, stroke: COLORS.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- hour of day --------------------------------------------------------------------

type HourRow = AccuracySummary["by_hour"][number];

function HourTooltip({ active, payload }: TooltipContentProps) {
  const row = rowOf<HourRow>(active, payload);
  if (!row) return null;
  const hh = String(row.hour).padStart(2, "0");
  return (
    <TooltipCard title={`${hh}:00–${hh}:59 UK time`} footer={`${row.count} hours scored`}>
      <TooltipRow color={COLORS.forecast} label="Mean abs. error" value={formatMW(row.mae_mw)} />
      <TooltipRow label="Bias" value={formatSignedPower(row.bias_mw)} />
      <TooltipRow label="1-in-10 miss" value={formatMW(row.p90_abs_mw)} />
    </TooltipCard>
  );
}

export function HourOfDayChart({ rows }: { rows: AccuracySummary["by_hour"] }) {
  const ticks = ticksFor(rows.map((r) => r.mae_mw), { count: 4 });
  return (
    <div>
      <AxisUnit>GW</AxisUnit>
      <div className={PLOT}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={CHART_MARGIN} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis
              dataKey="hour"
              tickFormatter={(h: number) => String(h).padStart(2, "0")}
              interval={2}
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={false}
            />
            <YAxis {...yAxisProps(ticks, formatAxisGW)} />
            <Tooltip content={(props) => <HourTooltip {...props} />} cursor={{ fill: COLORS.grid, fillOpacity: 0.5 }} isAnimationActive={false} />
            <Bar dataKey="mae_mw" fill={COLORS.forecast} radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- wind level -----------------------------------------------------------------------

type LevelRow = AccuracySummary["by_level"][number] & { label: string };

function LevelTooltip({ active, payload }: TooltipContentProps) {
  const row = rowOf<LevelRow>(active, payload);
  if (!row) return null;
  return (
    <TooltipCard title={`Forecast ${row.label} GW`} footer={`${row.count} hours in this band`}>
      <TooltipRow color={COLORS.forecast} label="Bias" value={formatSignedPower(row.bias_mw)} />
      <TooltipRow label="Outturn / forecast" value={formatPct(row.realisation_rate)} />
      <TooltipRow label="Mean abs. error" value={formatMW(row.mae_mw)} />
    </TooltipCard>
  );
}

export function LevelBiasChart({ rows }: { rows: AccuracySummary["by_level"] }) {
  const data: LevelRow[] = rows.map((r) => ({ ...r, label: `${r.lower_mw / 1000}–${r.upper_mw / 1000}` }));
  const ticks = ticksFor(rows.map((r) => r.bias_mw), { count: 4 });
  return (
    <div>
      <AxisUnit>GW of bias</AxisUnit>
      <div className={PLOT}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_MARGIN} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={AXIS_LINE} tickLine={false} interval={0} />
            <YAxis {...yAxisProps(ticks, formatAxisGW)} />
            <ReferenceLine y={0} stroke={COLORS.axis} />
            <Tooltip content={(props) => <LevelTooltip {...props} />} cursor={{ fill: COLORS.grid, fillOpacity: 0.5 }} isAnimationActive={false} />
            <Bar dataKey="bias_mw" fill={COLORS.forecast} radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- distribution ---------------------------------------------------------------------

type BinRow = AccuracySummary["distribution"][number] & { label: string; over: boolean };

function BinTooltip({ active, payload }: TooltipContentProps) {
  const row = rowOf<BinRow>(active, payload);
  if (!row) return null;
  return (
    <TooltipCard
      title={`Error ${formatSignedPower(row.lower_mw)} to ${formatSignedPower(row.upper_mw)}`}
      footer={row.over ? "Forecast too high: you would be short" : "Forecast too low: you would be long"}
    >
      <TooltipRow color={row.over ? COLORS.forecast : COLORS.deemph} label="Hours" value={row.count} />
    </TooltipCard>
  );
}

export function ErrorHistogram({ bins }: { bins: AccuracySummary["distribution"] }) {
  const data: BinRow[] = bins.map((b) => ({ ...b, label: formatAxisGW(b.lower_mw), over: b.lower_mw >= 0 }));
  // Label whole gigawatts only, so the axis reads −2, −1, 0, 1, 2 ...
  const xTicks = data.filter((b) => b.lower_mw % 1000 === 0).map((b) => b.label);
  const yTicks = ticksFor(bins.map((b) => b.count), { count: 4 });
  return (
    <div>
      <AxisUnit>Hours, by error in GW (forecast − actual)</AxisUnit>
      <div className={PLOT}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_MARGIN} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="label" ticks={xTicks} interval={0} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
            <YAxis {...yAxisProps(yTicks)} allowDecimals={false} />
            <Tooltip content={(props) => <BinTooltip {...props} />} cursor={{ fill: COLORS.grid, fillOpacity: 0.5 }} isAnimationActive={false} />
            <Bar dataKey="count" radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false}>
              {data.map((bin) => (
                <Cell key={bin.lower_mw} fill={bin.over ? COLORS.forecast : COLORS.deemph} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
