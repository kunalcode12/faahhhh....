"use client";

import type { DayAhead, DayAheadHour } from "@/lib/api/schemas";
import { downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import { formatMW, formatSignedPower, ukTime } from "@/lib/format";

import { DataTable, type Column } from "../charts/kit";
import { Button } from "../ui/button";

const dash = "–";
const mwOrDash = (value: number | null) => (value === null ? dash : formatMW(value));

const COLUMNS: Column<DayAheadHour>[] = [
  { header: "Hour (UK)", cell: (h) => ukTime(h.start_time) },
  { header: "SP", cell: (h) => h.settlement_period, align: "right" },
  { header: "NESO forecast", cell: (h) => formatMW(h.forecast_mw), align: "right" },
  { header: "Calibrated", cell: (h) => mwOrDash(h.calibrated_mw), align: "right" },
  { header: "P10", cell: (h) => mwOrDash(h.p10_mw), align: "right" },
  { header: "P90", cell: (h) => mwOrDash(h.p90_mw), align: "right" },
  { header: "Actual", cell: (h) => mwOrDash(h.actual_mw), align: "right" },
  { header: "NESO error", cell: (h) => (h.error_mw === null ? dash : formatSignedPower(h.error_mw)), align: "right" },
];

const CSV_COLUMNS: CsvColumn<DayAheadHour>[] = [
  { header: "start_time_utc", value: (h) => h.start_time },
  { header: "settlement_period", value: (h) => h.settlement_period },
  { header: "forecast_mw", value: (h) => h.forecast_mw },
  { header: "calibrated_mw", value: (h) => h.calibrated_mw },
  { header: "p10_mw", value: (h) => h.p10_mw },
  { header: "p90_mw", value: (h) => h.p90_mw },
  { header: "actual_mw", value: (h) => h.actual_mw },
  { header: "error_mw", value: (h) => h.error_mw },
  { header: "run_published_utc", value: (h) => h.published_at },
  { header: "lead_time_hours", value: (h) => h.horizon_hours },
];

export function HourTable({ day }: { day: DayAhead }) {
  return (
    <div className="space-y-3">
      <DataTable
        rows={day.hours}
        columns={COLUMNS}
        rowKey={(h) => h.start_time}
        caption={`Hourly wind forecast and outturn for ${day.delivery_date}`}
      />
      <Button
        variant="outline"
        onClick={() =>
          downloadCsv(`beaufort-day-ahead-${day.delivery_date}-gate-${day.gate.local_time.replace(":", "")}.csv`, toCsv(day.hours, CSV_COLUMNS))
        }
      >
        Download CSV
      </Button>
    </div>
  );
}
