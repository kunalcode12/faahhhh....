import { describe, expect, it } from "vitest";

import { niceTicks, ticksFor } from "@/lib/chart-scale";
import { addDays, clampYmd, daysInclusive, isYmd } from "@/lib/dates";
import { gateLabel, normaliseGate, parseAccuracy, parseDayAhead, rangePresets } from "@/lib/params";

const COVERAGE = { from: "2026-01-02", to: "2026-02-01" };

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isYmd("2026-01-15")).toBe(true);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("15/01/2026")).toBe(false);
    expect(isYmd(null)).toBe(false);
  });

  it("does day arithmetic across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-02", -1)).toBe("2026-01-01");
    expect(clampYmd("2026-03-01", COVERAGE.from, COVERAGE.to)).toBe("2026-02-01");
    expect(daysInclusive(COVERAGE.from, COVERAGE.to)).toBe(31);
  });
});

describe("gates", () => {
  it("accepts HH:MM and HHMM, rejects nonsense", () => {
    expect(normaliseGate("09:50")).toBe("0950");
    expect(normaliseGate("1530")).toBe("1530");
    expect(normaliseGate("25:00")).toBeNull();
    expect(normaliseGate("9:50")).toBeNull();
    expect(gateLabel("0920")).toBe("09:20");
  });
});

describe("URL state", () => {
  it("falls back to sensible defaults", () => {
    expect(parseDayAhead(new URLSearchParams(), COVERAGE)).toEqual({
      date: "2026-02-01",
      gate: "0950",
      lookback: 14,
    });
  });

  it("clamps and sanitises what it is given", () => {
    const params = parseDayAhead(new URLSearchParams("date=2025-06-01&gate=hack&lookback=3"), COVERAGE);
    expect(params).toEqual({ date: "2026-01-02", gate: "0950", lookback: 14 });
  });

  it("parses accuracy state, swapping a reversed range", () => {
    const params = parseAccuracy(
      new URLSearchParams("from=2026-01-20&to=2026-01-10&mode=horizon&h=6"),
      COVERAGE,
    );
    expect(params).toMatchObject({ from: "2026-01-10", to: "2026-01-20", mode: "horizon", horizon: 6 });
    expect(parseAccuracy(new URLSearchParams("h=99"), COVERAGE).horizon).toBe(24);
  });

  it("builds week presets inside the window", () => {
    const presets = rangePresets(COVERAGE);
    expect(presets[0]).toMatchObject({ id: "all", from: "2026-01-02", to: "2026-02-01" });
    expect(presets.find((p) => p.id === "w1")).toMatchObject({ from: "2026-01-02", to: "2026-01-08" });
    expect(presets.at(-1)).toMatchObject({ id: "last7", from: "2026-01-26", to: "2026-02-01" });
    expect(presets.every((p) => p.from >= COVERAGE.from && p.to <= COVERAGE.to)).toBe(true);
  });
});

describe("axis ticks", () => {
  it("uses round steps that hug the data", () => {
    expect(niceTicks(0, 17_805)).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(niceTicks(0, 21_353)).toEqual([0, 5000, 10000, 15000, 20000, 25000]);
    expect(niceTicks(254, 291, { includeZero: false, count: 4 })).toEqual([240, 260, 280, 300]);
  });

  it("spans negative values", () => {
    const ticks = niceTicks(-600, 4_600, { count: 4 });
    expect(ticks[0]).toBeLessThanOrEqual(-600);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(4_600);
    expect(ticks).toContain(0);
  });

  it("ignores missing values", () => {
    expect(ticksFor([null, 3, null, 9])).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticksFor([null])).toEqual([0, 1]);
  });
});
