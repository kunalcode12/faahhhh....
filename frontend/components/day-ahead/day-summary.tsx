import type { DayAhead } from "@/lib/api/schemas";
import { addDays } from "@/lib/dates";
import {
  formatDateShort,
  formatEnergy,
  formatMinutes,
  formatPct,
  formatPower,
  formatSignedPct,
  formatSignedPower,
  ukTime,
} from "@/lib/format";

import { Stat } from "../ui/stat";

/**
 * The answer to "what do we know about tomorrow's wind?" in five numbers.
 * The hero is the forecast exactly as NESO published it before the gate;
 * the tiles add what our calibration and the eventual outturn say about it.
 */
export function DaySummary({ day, gateName }: { day: DayAhead; gateName: string }) {
  const { summary: s, calibration: cal } = day;
  const decisionDay = addDays(day.delivery_date, -1);

  const outturnDetail =
    s.actual_energy_mwh === null
      ? "The day is not fully metered yet."
      : [
          `NESO ${formatSignedPct(s.forecast_energy_mwh / s.actual_energy_mwh - 1)}`,
          s.calibrated_energy_mwh !== null
            ? `calibrated ${formatSignedPct(s.calibrated_energy_mwh / s.actual_energy_mwh - 1)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <section aria-label="Summary" className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
      <div className="rise flex flex-col justify-between rounded-3xl bg-ink p-6 text-page sm:p-8">
        <div>
          <p className="text-sm font-semibold opacity-70">NESO wind forecast at the gate</p>
          <p className="mt-3 text-6xl font-black leading-none tracking-[-0.045em] sm:text-7xl">
            {formatEnergy(s.forecast_energy_mwh)}
          </p>
        </div>
        <p className="mt-6 text-sm leading-relaxed opacity-80">
          From the run published {formatDateShort(decisionDay)} at {ukTime(day.vintage.published_at)},{" "}
          {formatMinutes(day.vintage.minutes_before_gate)} before the {gateName} gate. Peaks at{" "}
          {formatPower(s.forecast_peak.mw)} around {ukTime(s.forecast_peak.start_time)}, lowest{" "}
          {formatPower(s.forecast_trough.mw)} around {ukTime(s.forecast_trough.start_time)}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          className="rise"
          label="Calibrated expectation"
          series="calibrated"
          value={s.calibrated_energy_mwh !== null ? formatEnergy(s.calibrated_energy_mwh) : "—"}
          detail={
            cal
              ? `The last ${cal.lookback_days} settled days delivered ${formatPct(cal.realisation_rate)} of what was forecast.`
              : "Not enough settled history to calibrate this day."
          }
        />
        <Stat
          className="rise"
          label="80% range, each hour"
          value={cal ? `${formatSignedPower(cal.residual_p10_mw)} / ${formatSignedPower(cal.residual_p90_mw)}` : "—"}
          detail="Around the calibrated line: 8 in 10 hours land inside, judging by recent errors."
        />
        <Stat
          className="rise"
          label="Outturn"
          series="actual"
          value={s.actual_energy_mwh !== null ? formatEnergy(s.actual_energy_mwh) : "Pending"}
          detail={outturnDetail}
        />
        <Stat
          className="rise"
          label="Typical hourly miss"
          series="forecast"
          value={s.raw_error ? formatPower(s.raw_error.mae_mw) : "—"}
          detail={
            s.calibrated_error
              ? `Calibrated: ${formatPower(s.calibrated_error.mae_mw)}. ${formatPct(s.band_coverage ?? 0)} of hours fell inside the 80% range.`
              : "Mean absolute error of the published forecast."
          }
        />
      </div>
    </section>
  );
}
