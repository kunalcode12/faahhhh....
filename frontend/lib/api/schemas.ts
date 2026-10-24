/**
 * Runtime contracts for the API, mirroring the backend's Pydantic models.
 *
 * Every response is validated before it reaches a component, so a backend
 * change shows up as a clear "unexpected response" error instead of a chart
 * quietly rendering NaN. Types are inferred from the schemas: one source of truth.
 * Unknown fields are stripped, so the backend can add fields without breaking us.
 */
import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string(); // ISO 8601 UTC, e.g. 2026-01-15T09:30:00Z

export const ErrorStatsSchema = z.object({
  count: z.number(),
  mae_mw: z.number(),
  rmse_mw: z.number(),
  bias_mw: z.number(),
  wape: z.number().nullable(),
  p50_abs_mw: z.number(),
  p90_abs_mw: z.number(),
  p95_abs_mw: z.number(),
  p99_abs_mw: z.number(),
  max_abs_mw: z.number(),
  over_forecast_share: z.number(),
  correlation: z.number().nullable(),
  mean_forecast_mw: z.number(),
  mean_actual_mw: z.number(),
});
export type ErrorStats = z.infer<typeof ErrorStatsSchema>;

// --- meta ---------------------------------------------------------------------------

export const GatePresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  venue: z.string(),
  product: z.string(),
  gate: z.string(),
  results: z.string(),
  description: z.string(),
});
export type GatePreset = z.infer<typeof GatePresetSchema>;

export const MetaSchema = z.object({
  name: z.string(),
  version: z.string(),
  coverage: z.object({
    decision_date_from: ymd,
    decision_date_to: ymd,
    delivery_date_from: ymd,
    delivery_date_to: ymd,
    timezone: z.string(),
  }),
  gates: z.array(GatePresetSchema),
  defaults: z.object({ gate: z.string(), lookback_days: z.number(), horizon_hours: z.number() }),
  limits: z.object({
    lookback_days_options: z.array(z.number()),
    lookback_days_min: z.number(),
    lookback_days_max: z.number(),
    horizon_hours_max: z.number(),
  }),
  dataset: z.object({
    version: z.string(),
    source: z.string(),
    origin: z.string(),
    generated_at: instant,
    loaded_at: instant,
    actual_days_from: ymd,
    actual_days_to: ymd,
    actual_points: z.number(),
    forecast_points: z.number(),
    forecast_vintages: z.number(),
    quality: z.object({
      actual_periods_expected: z.number(),
      actual_periods_present: z.number(),
      missing_actual_periods: z.array(instant),
      forecast_vintages: z.number(),
      forecast_points: z.number(),
      max_vintage_gap_hours: z.number(),
      duplicate_rows_dropped: z.number(),
      invalid_rows_dropped: z.number(),
    }),
  }),
});
export type Meta = z.infer<typeof MetaSchema>;

// --- day-ahead -----------------------------------------------------------------------

const GateSchema = z.object({ local_time: z.string(), closes_at: instant });

const PeakSchema = z.object({ mw: z.number(), start_time: instant });

export const DayAheadSchema = z.object({
  delivery_date: ymd,
  settlement_periods: z.number(),
  gate: GateSchema,
  vintage: z.object({ published_at: instant, minutes_before_gate: z.number() }),
  calibration: z
    .object({
      lookback_days: z.number(),
      history_from: ymd,
      history_to: ymd,
      sample_size: z.number(),
      realisation_rate: z.number(),
      residual_p10_mw: z.number(),
      residual_p90_mw: z.number(),
    })
    .nullable(),
  summary: z.object({
    forecast_energy_mwh: z.number(),
    calibrated_energy_mwh: z.number().nullable(),
    actual_energy_mwh: z.number().nullable(),
    forecast_peak: PeakSchema,
    forecast_trough: PeakSchema,
    forecast_mean_mw: z.number(),
    raw_error: ErrorStatsSchema.nullable(),
    calibrated_error: ErrorStatsSchema.nullable(),
    band_coverage: z.number().nullable(),
  }),
  hours: z.array(
    z.object({
      start_time: instant,
      settlement_period: z.number(),
      forecast_mw: z.number(),
      calibrated_mw: z.number().nullable(),
      p10_mw: z.number().nullable(),
      p90_mw: z.number().nullable(),
      actual_mw: z.number().nullable(),
      error_mw: z.number().nullable(),
      calibrated_error_mw: z.number().nullable(),
      published_at: instant,
      horizon_hours: z.number(),
    }),
  ),
  actuals: z.array(
    z.object({ start_time: instant, settlement_period: z.number(), actual_mw: z.number() }),
  ),
  notes: z.array(z.string()),
});
export type DayAhead = z.infer<typeof DayAheadSchema>;
export type DayAheadHour = DayAhead["hours"][number];

const PointSchema = z.object({ start_time: instant, mw: z.number() });

export const VintagesSchema = z.object({
  delivery_date: ymd,
  gate: GateSchema,
  actual_energy_mwh: z.number().nullable(),
  actual_hourly: z.array(PointSchema),
  vintages: z.array(
    z.object({
      published_at: instant,
      status: z.enum(["used", "before_gate", "after_gate"]),
      hours_ahead_of_delivery: z.number(),
      energy_mwh: z.number(),
      points: z.array(PointSchema),
    }),
  ),
});
export type Vintages = z.infer<typeof VintagesSchema>;
export type Vintage = Vintages["vintages"][number];

// --- accuracy ------------------------------------------------------------------------

const WindowSchema = z.object({
  start: ymd,
  end: ymd,
  mode: z.enum(["gate", "horizon"]),
  gate: z.string().nullable(),
  horizon_hours: z.number().nullable(),
  lookback_days: z.number().nullable(),
});

export const AccuracySummarySchema = z.object({
  window: WindowSchema,
  raw: ErrorStatsSchema.nullable(),
  calibrated: ErrorStatsSchema.nullable(),
  band_coverage: z.number().nullable(),
  lead_time_hours: z.tuple([z.number(), z.number()]).nullable(),
  by_hour: z.array(
    z.object({
      hour: z.number(),
      count: z.number(),
      mae_mw: z.number(),
      bias_mw: z.number(),
      p90_abs_mw: z.number(),
    }),
  ),
  by_level: z.array(
    z.object({
      lower_mw: z.number(),
      upper_mw: z.number(),
      count: z.number(),
      mae_mw: z.number(),
      bias_mw: z.number(),
      realisation_rate: z.number(),
    }),
  ),
  distribution: z.array(z.object({ lower_mw: z.number(), upper_mw: z.number(), count: z.number() })),
  daily: z.array(
    z.object({
      delivery_date: ymd,
      mae_mw: z.number(),
      bias_mw: z.number(),
      calibrated_mae_mw: z.number().nullable(),
      forecast_energy_mwh: z.number(),
      actual_energy_mwh: z.number(),
    }),
  ),
});
export type AccuracySummary = z.infer<typeof AccuracySummarySchema>;

export const AccuracySeriesSchema = z.object({
  window: WindowSchema,
  forecasts: z.array(
    z.object({
      start_time: instant,
      forecast_mw: z.number(),
      published_at: instant,
      horizon_hours: z.number(),
      actual_mw: z.number().nullable(),
    }),
  ),
  actuals: z.array(z.object({ start_time: instant, actual_mw: z.number() })),
});
export type AccuracySeries = z.infer<typeof AccuracySeriesSchema>;

export const HorizonCurveSchema = z.object({
  start: ymd,
  end: ymd,
  buckets: z.array(
    z.object({
      horizon_hours: z.number(),
      count: z.number(),
      mae_mw: z.number(),
      rmse_mw: z.number(),
      bias_mw: z.number(),
      p90_abs_mw: z.number(),
    }),
  ),
});
export type HorizonCurve = z.infer<typeof HorizonCurveSchema>;
