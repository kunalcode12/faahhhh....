import type { AccuracySummary, DayAhead, ErrorStats, HorizonCurve } from "@/lib/api/schemas";

export function stats(overrides: Partial<ErrorStats> = {}): ErrorStats {
  return {
    count: 744,
    mae_mw: 1995.6,
    rmse_mw: 2498.6,
    bias_mw: 1728,
    wape: 0.177,
    p50_abs_mw: 1626,
    p90_abs_mw: 4202,
    p95_abs_mw: 5000,
    p99_abs_mw: 6200,
    max_abs_mw: 6857,
    over_forecast_share: 0.84,
    correlation: 0.93,
    mean_forecast_mw: 13000,
    mean_actual_mw: 11284,
    ...overrides,
  };
}

export function summary(overrides: Partial<AccuracySummary> = {}): AccuracySummary {
  return {
    window: { start: "2026-01-02", end: "2026-02-01", mode: "gate", gate: "09:50", horizon_hours: null, lookback_days: 14 },
    raw: stats(),
    calibrated: stats({ mae_mw: 1292.1, bias_mw: 120 }),
    band_coverage: 0.82,
    lead_time_hours: [14.5, 37.5],
    by_hour: [],
    by_level: [
      { lower_mw: 0, upper_mw: 2000, count: 3, mae_mw: 600, bias_mw: 500, realisation_rate: 0.7 },
      { lower_mw: 6000, upper_mw: 8000, count: 112, mae_mw: 1196, bias_mw: 140, realisation_rate: 0.98 },
      { lower_mw: 12000, upper_mw: 14000, count: 97, mae_mw: 1501, bias_mw: 1338, realisation_rate: 0.9 },
      { lower_mw: 20000, upper_mw: 22000, count: 40, mae_mw: 4134, bias_mw: 4134, realisation_rate: 0.78 },
    ],
    distribution: [],
    daily: [],
    ...overrides,
  };
}

export function curve(): HorizonCurve {
  return {
    start: "2026-01-02",
    end: "2026-02-01",
    buckets: [0, 1, 24, 48].map((h) => ({
      horizon_hours: h,
      count: 248,
      mae_mw: 1680 + h * 14.6,
      rmse_mw: 2000,
      bias_mw: 1500,
      p90_abs_mw: 3600,
    })),
  };
}

function hour(iso: string, sp: number, forecast: number, actual: number | null) {
  return {
    start_time: iso,
    settlement_period: sp,
    forecast_mw: forecast,
    calibrated_mw: forecast * 0.87,
    p10_mw: forecast * 0.87 - 2400,
    p90_mw: forecast * 0.87 + 2300,
    actual_mw: actual,
    error_mw: actual === null ? null : forecast - actual,
    calibrated_error_mw: actual === null ? null : forecast * 0.87 - actual,
    published_at: "2026-01-14T09:30:00Z",
    horizon_hours: 14.5,
  };
}

export function dayAhead(): DayAhead {
  return {
    delivery_date: "2026-01-15",
    settlement_periods: 48,
    gate: { local_time: "09:50", closes_at: "2026-01-14T09:50:00Z" },
    vintage: { published_at: "2026-01-14T09:30:00Z", minutes_before_gate: 20 },
    calibration: null,
    summary: {
      forecast_energy_mwh: 2000,
      calibrated_energy_mwh: null,
      actual_energy_mwh: null,
      forecast_peak: { mw: 1000, start_time: "2026-01-15T00:00:00Z" },
      forecast_trough: { mw: 1000, start_time: "2026-01-15T01:00:00Z" },
      forecast_mean_mw: 1000,
      raw_error: null,
      calibrated_error: null,
      band_coverage: null,
    },
    hours: [hour("2026-01-15T00:00:00Z", 1, 1000, 900), hour("2026-01-15T01:00:00Z", 3, 1100, 950)],
    actuals: [
      { start_time: "2026-01-15T00:00:00Z", settlement_period: 1, actual_mw: 900 },
      { start_time: "2026-01-15T00:30:00Z", settlement_period: 2, actual_mw: 920 },
      { start_time: "2026-01-15T01:00:00Z", settlement_period: 3, actual_mw: 950 },
      { start_time: "2026-01-15T01:30:00Z", settlement_period: 4, actual_mw: 970 },
    ],
    notes: [],
  };
}
