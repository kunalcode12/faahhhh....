import type { AccuracySummary } from "@/lib/api/schemas";
import { formatPct, formatPower, formatSignedPct, formatSignedPower } from "@/lib/format";
import type { Insight } from "@/lib/insights";

import { Stat } from "../ui/stat";

export function AccuracyHeadline({ summary }: { summary: AccuracySummary }) {
  const { raw, calibrated, window } = summary;
  if (!raw) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-8 text-ink-2">
        No hours with both a forecast and a metered outturn in this window.
      </div>
    );
  }
  const scored = window.mode === "gate" ? "forecast available at the gate" : `latest run published ${window.horizon_hours} h or more ahead`;

  return (
    <section aria-label="Headline accuracy" className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
      <div className="rise flex flex-col justify-between rounded-3xl bg-ink p-6 text-page sm:p-8">
        <div>
          <p className="text-sm font-semibold opacity-70">Typical miss, per hour</p>
          <p className="mt-3 text-6xl font-black leading-none tracking-[-0.045em] sm:text-7xl">
            {formatPower(raw.mae_mw)}
          </p>
        </div>
        <div className="mt-6 space-y-3">
          <p className="text-sm leading-relaxed opacity-80">
            Mean absolute error of the {scored}, over {raw.count.toLocaleString("en-GB")} hours.
            {raw.wape !== null ? ` That is ${formatPct(raw.wape, 1)} of the wind energy delivered.` : ""}
          </p>
          {calibrated ? (
            <p className="inline-flex flex-wrap items-center gap-2 rounded-full bg-page/10 px-3 py-1.5 text-sm font-bold">
              <span aria-hidden className="h-[3px] w-4 rounded-full bg-calibrated" />
              Calibrated: {formatPower(calibrated.mae_mw)} ({formatSignedPct(calibrated.mae_mw / raw.mae_mw - 1, 0)})
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          className="rise"
          label="Bias"
          series="forecast"
          value={formatSignedPower(raw.bias_mw)}
          detail={`Too high in ${formatPct(raw.over_forecast_share)} of hours. Positive means less wind turned up than forecast.`}
        />
        <Stat
          className="rise"
          label="1-in-10 miss (P90)"
          value={formatPower(raw.p90_abs_mw)}
          detail="Nine hours in ten miss by less than this."
        />
        <Stat
          className="rise"
          label="1-in-100 miss (P99)"
          value={formatPower(raw.p99_abs_mw)}
          detail={`The single largest miss was ${formatPower(raw.max_abs_mw)}.`}
        />
        {summary.band_coverage !== null ? (
          <Stat
            className="rise"
            label="Inside the 80% range"
            series="calibrated"
            value={formatPct(summary.band_coverage)}
            detail="Hours whose outturn landed between P10 and P90. Close to 80% means the range is honest."
          />
        ) : (
          <Stat
            className="rise"
            label="Shape match"
            value={raw.correlation !== null ? raw.correlation.toFixed(2) : "—"}
            detail="Correlation of forecast and outturn, ignoring bias (1.00 is perfect)."
          />
        )}
      </div>
    </section>
  );
}

export function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section aria-labelledby="takeaways" className="rise rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <h2 id="takeaways" className="text-sm font-semibold text-ink-2">
        What this means for the desk
      </h2>
      <ol className="mt-5 grid gap-x-10 gap-y-6 md:grid-cols-2">
        {insights.map((insight, index) => (
          <li key={insight.id} className="flex gap-4">
            <span className="tabular text-sm font-black text-muted">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p className="text-xl font-extrabold leading-snug tracking-tight">{insight.headline}</p>
              <p className="mt-1.5 leading-relaxed text-ink-2">{insight.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
