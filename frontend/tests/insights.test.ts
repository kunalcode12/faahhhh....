import { describe, expect, it } from "vitest";

import { buildDayRows } from "@/components/charts/day-profile-chart";
import {
  biasInsight,
  calibrationInsight,
  insightsFor,
  leadTimeInsight,
  levelInsight,
} from "@/lib/insights";

import { curve, dayAhead, stats, summary } from "./fixtures";

describe("insights", () => {
  it("names the direction of the bias", () => {
    expect(biasInsight(summary())?.headline).toBe("The forecast runs hot.");
    const cold = summary({ raw: stats({ bias_mw: -300, over_forecast_share: 0.3 }) });
    expect(biasInsight(cold)?.headline).toBe("The forecast runs cold.");
  });

  it("finds the windy-day over-promise, ignoring thin buckets", () => {
    const insight = levelInsight(summary());
    expect(insight?.body).toContain("20–22 GW, only 78%");
    expect(insight?.body).toContain("98% at 6–8 GW");
  });

  it("quantifies what calibration buys", () => {
    expect(calibrationInsight(summary())?.headline).toBe("Calibration cuts the miss by 35%.");
    expect(calibrationInsight(summary({ calibrated: null }))).toBeNull();
  });

  it("describes lead-time decay per day", () => {
    const insight = leadTimeInsight(curve());
    expect(insight?.body).toContain("at 1 h ahead");
    expect(insight?.body).toContain("at 48 h");
    expect(leadTimeInsight(undefined)).toBeNull();
  });

  it("omits what it cannot support", () => {
    const thin = summary({ raw: null, calibrated: null, band_coverage: null, by_level: [] });
    expect(insightsFor(thin, undefined)).toEqual([]);
  });
});

describe("day chart rows", () => {
  it("merges hourly forecasts with half-hourly outturn without inventing values", () => {
    const rows = buildDayRows(dayAhead());
    expect(rows.map((r) => r.sp)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.forecast)).toEqual([1000, null, 1100, null]);
    expect(rows.map((r) => r.actual)).toEqual([900, 920, 950, 970]);
    // Half-hours point at their hour's forecast for the tooltip only.
    expect(rows[1].ref?.start_time).toBe("2026-01-15T00:00:00Z");
    expect(rows[3].ref?.start_time).toBe("2026-01-15T01:00:00Z");
  });
});
