import { describe, expect, it } from "vitest";

import {
  formatAxisGW,
  formatDateLong,
  formatDateShort,
  formatEnergy,
  formatMinutes,
  formatMW,
  formatPct,
  formatPower,
  formatSignedPct,
  formatSignedPower,
  ukDayTime,
  ukTime,
} from "@/lib/format";

const MINUS = "−";

describe("power and energy", () => {
  it("uses the unit a trader would say", () => {
    expect(formatPower(850)).toBe("850 MW");
    expect(formatPower(12_431)).toBe("12.4 GW");
    expect(formatMW(12_431)).toBe("12,431 MW");
    expect(formatMW(-420)).toBe(`${MINUS}420 MW`);
  });

  it("signs errors with a real minus sign", () => {
    expect(formatSignedPower(1728)).toBe("+1.7 GW");
    expect(formatSignedPower(-420)).toBe(`${MINUS}420 MW`);
    expect(formatSignedPower(0.2)).toBe("0 MW");
    expect(formatAxisGW(-2000)).toBe(`${MINUS}2`);
    expect(formatAxisGW(12_500)).toBe("12.5");
  });

  it("scales energy", () => {
    expect(formatEnergy(280_272)).toBe("280 GWh");
    expect(formatEnergy(4_521)).toBe("4.5 GWh");
    expect(formatEnergy(850)).toBe("850 MWh");
    expect(formatEnergy(2_500_000)).toBe("2.5 TWh");
  });

  it("formats shares", () => {
    expect(formatPct(0.177, 1)).toBe("17.7%");
    expect(formatSignedPct(0.105)).toBe("+10.5%");
    expect(formatSignedPct(-0.043)).toBe(`${MINUS}4.3%`);
  });
});

describe("time", () => {
  it("shows UK local time, including summer time", () => {
    expect(ukTime("2026-01-15T09:30:00Z")).toBe("09:30");
    expect(ukTime("2026-07-01T08:50:00Z")).toBe("09:50"); // BST
    expect(ukDayTime("2026-01-14T09:30:00Z")).toMatch(/Wed 14 Jan,? 09:30/);
  });

  it("never shifts calendar dates across a timezone boundary", () => {
    expect(formatDateLong("2026-01-15")).toMatch(/Thursday,? 15 January 2026/);
    expect(formatDateShort("2026-02-01")).toMatch(/Sun,? 1 Feb/);
  });

  it("formats minutes", () => {
    expect(formatMinutes(20)).toBe("20 min");
    expect(formatMinutes(110)).toBe("1 h 50 min");
    expect(formatMinutes(120)).toBe("2 h");
  });
});
