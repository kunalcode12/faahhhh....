"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { Vintages } from "@/lib/api/schemas";
import { ticksFor } from "@/lib/chart-scale";
import { formatEnergy, formatHours, formatSignedPct, ukDayTime, ukTime } from "@/lib/format";

import { AXIS_LINE, AXIS_TICK, AxisUnit, CHART_MARGIN, COLORS, TooltipCard, TooltipRow } from "./kit";

type RunRow = {
  t: number;
  gwh: number;
  status: Vintages["vintages"][number]["status"];
  hoursAhead: number;
};

const HOUR_MS = 60 * 60_000;
const WINDOW_HOURS = 48;

const dayTick = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
});

const STATUS_COPY: Record<RunRow["status"], string> = {
  used: "The run available at the gate",
  before_gate: "Earlier run",
  after_gate: "Published after the gate",
};

function RunDot(props: { cx?: number; cy?: number; payload?: RunRow }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return <g />;
  if (payload.status === "used") {
    return <circle cx={cx} cy={cy} r={7} fill={COLORS.forecast} stroke={COLORS.surface} strokeWidth={2} />;
  }
  if (payload.status === "after_gate") {
    return <circle cx={cx} cy={cy} r={4.5} fill={COLORS.surface} stroke={COLORS.deemph} strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={4.5} fill={COLORS.deemph} stroke={COLORS.surface} strokeWidth={2} />;
}

function RunTooltip({ active, payload, actualGwh }: TooltipContentProps & { actualGwh: number | null }) {
  const row = active ? (payload?.[0]?.payload as RunRow | undefined) : undefined;
  if (!row) return null;
  return (
    <TooltipCard title={`Run ${ukDayTime(row.t)}`} footer={STATUS_COPY[row.status]}>
      <TooltipRow color={COLORS.forecast} label="Forecast for the day" value={formatEnergy(row.gwh * 1000)} />
      {actualGwh !== null ? (
        <TooltipRow label="vs outturn" value={formatSignedPct(row.gwh / actualGwh - 1)} />
      ) : null}
      <TooltipRow label="Before delivery" value={formatHours(row.hoursAhead)} />
    </TooltipCard>
  );
}

/**
 * Every forecast run published in the two days before delivery, by how much
 * wind it predicted for the whole day. The run the desk could bid on is
 * emphasised; the line shows the drift; the blue rule is what actually came.
 */
export function RunEnergyChart({ data }: { data: Vintages }) {
  const rows = useMemo<RunRow[]>(
    () =>
      data.vintages.map((v) => ({
        t: Date.parse(v.published_at),
        gwh: v.energy_mwh / 1000,
        status: v.status,
        hoursAhead: v.hours_ahead_of_delivery,
      })),
    [data],
  );
  const actualGwh = data.actual_energy_mwh === null ? null : data.actual_energy_mwh / 1000;
  const gateAt = Date.parse(data.gate.closes_at);

  // The window is the two days before delivery starts; ticks every 12 hours,
  // naming the day at each midnight so repeated clock times aren't ambiguous.
  const first = data.vintages[0];
  const deliveryStart = first ? Date.parse(first.published_at) + first.hours_ahead_of_delivery * HOUR_MS : gateAt;
  const xStart = deliveryStart - WINDOW_HOURS * HOUR_MS;
  const xTicks = Array.from({ length: WINDOW_HOURS / 12 + 1 }, (_, i) => xStart + i * 12 * HOUR_MS);
  const yTicks = ticksFor(rows.map((r) => r.gwh).concat(actualGwh === null ? [] : [actualGwh]), {
    includeZero: false,
    count: 4,
  });

  return (
    <div>
      <AxisUnit>GWh for the day</AxisUnit>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ ...CHART_MARGIN, top: 20 }}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[xStart, deliveryStart]}
              ticks={xTicks}
              tickFormatter={(t: number) => (ukTime(t) === "00:00" ? dayTick.format(t) : ukTime(t))}
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={false}
            />
            <YAxis
              ticks={yTicks}
              domain={[yTicks[0], yTicks[yTicks.length - 1]]}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <ReferenceLine
              x={gateAt}
              stroke={COLORS.axis}
              strokeWidth={1}
              label={{ value: `Gate ${data.gate.local_time}`, position: "insideTopRight", fill: COLORS.muted, fontSize: 12 }}
            />
            {actualGwh !== null ? (
              <ReferenceLine
                y={actualGwh}
                stroke={COLORS.actual}
                strokeWidth={2}
                label={{ value: "Outturn", position: "insideBottomLeft", fill: COLORS.muted, fontSize: 12 }}
              />
            ) : null}
            <Tooltip
              content={(props) => <RunTooltip {...props} actualGwh={actualGwh} />}
              cursor={{ stroke: COLORS.axis, strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="gwh"
              stroke={COLORS.deemph}
              strokeWidth={2}
              dot={(props) => <RunDot key={String(props.index)} {...props} />}
              activeDot={{ r: 7, stroke: COLORS.surface, strokeWidth: 2, fill: COLORS.ink }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
