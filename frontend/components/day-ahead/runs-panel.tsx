"use client";

import type { UseQueryResult } from "@tanstack/react-query";

import type { Vintage, Vintages } from "@/lib/api/schemas";
import { formatEnergy, formatHours, formatSignedPct, ukDayTime } from "@/lib/format";

import { ChartCard, COLORS, DataTable, Legend } from "../charts/kit";
import { RunEnergyChart } from "../charts/run-energy-chart";
import { ErrorPanel } from "../ui/error-panel";
import { Skeleton } from "../ui/skeleton";

const STATUS_LABEL: Record<Vintage["status"], string> = {
  used: "Used at the gate",
  before_gate: "Before the gate",
  after_gate: "After the gate",
};

function story(data: Vintages): string | null {
  const used = data.vintages.find((v) => v.status === "used");
  const latest = data.vintages.at(-1);
  if (!used || !latest) return null;
  const parts = [`The run you could bid on said ${formatEnergy(used.energy_mwh)}`];
  if (latest !== used) parts.push(`the last run before delivery said ${formatEnergy(latest.energy_mwh)}`);
  const sentence = parts.join("; ");
  return data.actual_energy_mwh === null
    ? `${sentence}.`
    : `${sentence}; the wind actually delivered ${formatEnergy(data.actual_energy_mwh)}.`;
}

export function RunsPanel({ query }: { query: UseQueryResult<Vintages> }) {
  if (query.isPending) return <Skeleton className="h-[440px] rounded-3xl" />;
  if (query.isError) {
    return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  const data = query.data;
  const actual = data.actual_energy_mwh;

  return (
    <ChartCard
      title="How the forecast moved"
      subtitle={story(data)}
      dimmed={query.isPlaceholderData}
      legend={
        <Legend
          entries={[
            { key: "used", label: "Run used at the gate", color: COLORS.forecast, kind: "dot" },
            { key: "before", label: "Earlier runs", color: COLORS.deemph, kind: "dot" },
            { key: "after", label: "Runs after the gate", color: COLORS.deemph, kind: "ring" },
            { key: "actual", label: "Outturn", color: COLORS.actual, kind: "line" },
          ]}
        />
      }
      table={
        <DataTable
          rows={data.vintages}
          rowKey={(v) => v.published_at}
          caption="Forecast runs for this delivery day"
          columns={[
            { header: "Run published", cell: (v) => ukDayTime(v.published_at) },
            { header: "Status", cell: (v) => STATUS_LABEL[v.status] },
            { header: "Ahead of delivery", cell: (v) => formatHours(v.hours_ahead_of_delivery), align: "right" },
            { header: "Day forecast", cell: (v) => formatEnergy(v.energy_mwh), align: "right" },
            {
              header: "vs outturn",
              cell: (v) => (actual === null ? "–" : formatSignedPct(v.energy_mwh / actual - 1)),
              align: "right",
            },
          ]}
        />
      }
      footnote="NESO publishes about eight runs a day. Each point is one run's total for this delivery day (hourly MW summed to MWh)."
    >
      <RunEnergyChart data={data} />
    </ChartCard>
  );
}
