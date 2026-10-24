/**
 * Plain-English takeaways computed from the accuracy numbers. Pure functions,
 * so the copy a trader reads is unit-tested like any other logic.
 */
import type { AccuracySummary, HorizonCurve } from "./api/schemas";
import { formatPct, formatPower, formatSignedPower } from "./format";

export type Insight = { id: string; headline: string; body: string };

const MIN_BUCKET_HOURS = 12;

export function biasInsight(summary: AccuracySummary): Insight | null {
  const raw = summary.raw;
  if (!raw) return null;
  const hot = raw.bias_mw > 0;
  return {
    id: "bias",
    headline: hot ? "The forecast runs hot." : "The forecast runs cold.",
    body: hot
      ? `It was too high in ${formatPct(raw.over_forecast_share)} of hours, by ${formatSignedPower(raw.bias_mw)} on average. Taken at face value it means buying too little day-ahead and topping up later.`
      : `It was too low in ${formatPct(1 - raw.over_forecast_share)} of hours, by ${formatSignedPower(raw.bias_mw)} on average. Taken at face value it means over-buying day-ahead.`,
  };
}

export function levelInsight(summary: AccuracySummary): Insight | null {
  const buckets = summary.by_level.filter((b) => b.count >= MIN_BUCKET_HOURS && b.lower_mw > 0);
  if (buckets.length < 2) return null;
  const top = buckets[buckets.length - 1];
  const low = buckets.reduce((best, b) => (b.realisation_rate > best.realisation_rate ? b : best));
  if (top.realisation_rate >= low.realisation_rate) return null;
  return {
    id: "level",
    headline: "It over-promises most when it's windiest.",
    body: `When NESO forecast ${top.lower_mw / 1000}–${top.upper_mw / 1000} GW, only ${formatPct(top.realisation_rate)} of it turned up, against ${formatPct(low.realisation_rate)} at ${low.lower_mw / 1000}–${low.upper_mw / 1000} GW. That pattern fits output being curtailed by grid constraints on windy days.`,
  };
}

export function calibrationInsight(summary: AccuracySummary): Insight | null {
  const { raw, calibrated, band_coverage } = summary;
  if (!raw || !calibrated || band_coverage === null) return null;
  const cut = 1 - calibrated.mae_mw / raw.mae_mw;
  return {
    id: "calibration",
    headline: cut > 0 ? `Calibration cuts the miss by ${formatPct(cut)}.` : "Calibration doesn't help here.",
    body: `Scaling each day's forecast by what recent days actually delivered takes the typical miss from ${formatPower(raw.mae_mw)} to ${formatPower(calibrated.mae_mw)}, using only data available at the gate. ${formatPct(band_coverage)} of hours landed inside the 80% range.`,
  };
}

export function leadTimeInsight(curve: HorizonCurve | undefined): Insight | null {
  const buckets = curve?.buckets ?? [];
  const near = buckets.find((b) => b.horizon_hours === 1) ?? buckets[0];
  const far = buckets.at(-1);
  if (!near || !far || far.horizon_hours - near.horizon_hours < 12) return null;
  const perDay = ((far.mae_mw - near.mae_mw) / (far.horizon_hours - near.horizon_hours)) * 24;
  return {
    id: "lead",
    headline: "Fresher forecasts are better, but only a little.",
    body: `The typical miss grows from ${formatPower(near.mae_mw)} at ${near.horizon_hours} h ahead to ${formatPower(far.mae_mw)} at ${far.horizon_hours} h: about ${formatPower(perDay)} worse per extra day of lead time. Waiting for a later run trims the error; it doesn't remove the bias.`,
  };
}

export function insightsFor(summary: AccuracySummary, curve: HorizonCurve | undefined): Insight[] {
  return [biasInsight(summary), levelInsight(summary), calibrationInsight(summary), leadTimeInsight(curve)].filter(
    (insight): insight is Insight => insight !== null,
  );
}
