"use client";

import type { AccuracySummary } from "@/lib/api/schemas";
import { downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import { formatDateShort, formatEnergy, formatMW, formatSignedPower } from "@/lib/format";

import { ChartCard, DataTable, type Column } from "../charts/kit";
import { Button } from "../ui/button";

type Day = AccuracySummary["daily"][number];

export function DailyTable({ summary, dimmed }: { summary: AccuracySummary; dimmed: boolean }) {
  const gateMode = summary.window.mode === "gate";
  const columns: Column<Day>[] = [
    { header: "Delivery day", cell: (d) => formatDateShort(d.delivery_date) },
    { header: "Typical miss", cell: (d) => formatMW(d.mae_mw), align: "right" },
    { header: "Bias", cell: (d) => formatSignedPower(d.bias_mw), align: "right" },
    ...(gateMode
      ? [
          {
            header: "Calibrated miss",
            cell: (d: Day) => (d.calibrated_mae_mw === null ? "–" : formatMW(d.calibrated_mae_mw)),
            align: "right" as const,
          },
        ]
      : []),
    { header: "Forecast", cell: (d) => formatEnergy(d.forecast_energy_mwh), align: "right" },
    { header: "Actual", cell: (d) => formatEnergy(d.actual_energy_mwh), align: "right" },
  ];
  const csvColumns: CsvColumn<Day>[] = [
    { header: "delivery_date", value: (d) => d.delivery_date },
    { header: "mae_mw", value: (d) => d.mae_mw },
    { header: "bias_mw", value: (d) => d.bias_mw },
    { header: "calibrated_mae_mw", value: (d) => d.calibrated_mae_mw },
    { header: "forecast_energy_mwh", value: (d) => d.forecast_energy_mwh },
    { header: "actual_energy_mwh", value: (d) => d.actual_energy_mwh },
  ];

  return (
    <ChartCard
      title="Day by day"
      subtitle="Every delivery day in the window. Energy is summed over the scored hours, so forecast and actual compare like for like."
      dimmed={dimmed}
      actions={
        <Button
          variant="outline"
          className="h-8 rounded-xl px-3 text-xs"
          onClick={() =>
            downloadCsv(
              `beaufort-accuracy-${summary.window.start}-to-${summary.window.end}.csv`,
              toCsv(summary.daily, csvColumns),
            )
          }
        >
          Download CSV
        </Button>
      }
    >
      <DataTable
        rows={summary.daily}
        columns={columns}
        rowKey={(d) => d.delivery_date}
        caption="Forecast accuracy by delivery day"
      />
    </ChartCard>
  );
}
