/**
 * Display formatting. All instants arrive from the API in UTC and are shown in
 * UK local time, because that is the clock GB power is traded on.
 */

const UK = "Europe/London";
const MINUS = "−"; // a real minus sign, not a hyphen

const number0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const number1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
// Calendar dates (YYYY-MM-DD) are not instants: format them in UTC so no
// timezone shift can move them to the neighbouring day.
const longDateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayMonthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

function sign(value: number): string {
  return value > 0 ? "+" : value < 0 ? MINUS : "";
}

/** 12431 -> "12,431 MW" */
export function formatMW(mw: number): string {
  return `${mw < 0 ? MINUS : ""}${number0.format(Math.abs(mw))} MW`;
}

/** Picks the unit a trader would say out loud: 850 MW, 12.4 GW. */
export function formatPower(mw: number): string {
  const abs = Math.abs(mw);
  const prefix = mw < 0 ? MINUS : "";
  return abs >= 1000 ? `${prefix}${number1.format(abs / 1000)} GW` : `${prefix}${number0.format(abs)} MW`;
}

/** Signed power for errors and bias: "+1.7 GW", "−420 MW". */
export function formatSignedPower(mw: number): string {
  const abs = Math.abs(mw);
  const body = abs >= 1000 ? `${number1.format(abs / 1000)} GW` : `${number0.format(abs)} MW`;
  return `${sign(Math.round(mw))}${body}`;
}

/** 280272 -> "280 GWh"; 4521 -> "4.5 GWh"; 850 -> "850 MWh". */
export function formatEnergy(mwh: number): string {
  const abs = Math.abs(mwh);
  const prefix = mwh < 0 ? MINUS : "";
  if (abs >= 1_000_000) return `${prefix}${number1.format(abs / 1_000_000)} TWh`;
  if (abs >= 100_000) return `${prefix}${number0.format(abs / 1000)} GWh`;
  if (abs >= 1000) return `${prefix}${number1.format(abs / 1000)} GWh`;
  return `${prefix}${number0.format(abs)} MWh`;
}

/** 0.177 -> "17.7%" */
export function formatPct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

export function formatSignedPct(share: number, digits = 1): string {
  const value = Number((share * 100).toFixed(digits));
  return `${sign(value)}${Math.abs(value).toFixed(digits)}%`;
}

/** Axis ticks: compact GW with no unit clutter. 12500 -> "12.5", -2000 -> "−2". */
export function formatAxisGW(mw: number): string {
  const gw = Math.abs(mw) / 1000;
  const body = Number.isInteger(gw) ? String(gw) : gw.toFixed(1);
  return mw < 0 ? `${MINUS}${body}` : body;
}

export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** "09:30" in UK time */
export function ukTime(iso: string | number): string {
  return timeFmt.format(new Date(iso));
}

/** "Wed 14 Jan, 09:30" in UK time */
export function ukDayTime(iso: string | number): string {
  return dayTimeFmt.format(new Date(iso));
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Thursday 15 January 2026" */
export function formatDateLong(ymd: string): string {
  return longDateFmt.format(ymdToDate(ymd));
}

/** "Thu 15 Jan" */
export function formatDateShort(ymd: string): string {
  return shortDateFmt.format(ymdToDate(ymd));
}

/** "15 Jan" */
export function formatDayMonth(ymd: string): string {
  return dayMonthFmt.format(ymdToDate(ymd));
}

/** Human duration for "published 20 min before the gate". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
