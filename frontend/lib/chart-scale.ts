/**
 * Round-number axis ticks (steps of 1, 2, 2.5 or 5 x 10^n), so axes read
 * 0 / 5 / 10 / 15 GW rather than 0 / 4.5 / 9 / 13.5.
 *
 * Picks the smallest round step that needs at most `count + 1` ticks, which
 * keeps the top of the axis close to the data instead of leaving dead space.
 */
const MULTIPLIERS = [0.5, 1, 2, 2.5, 5, 10, 20];

export function niceTicks(
  min: number,
  max: number,
  { count = 5, includeZero = true }: { count?: number; includeZero?: boolean } = {},
): number[] {
  let lo = includeZero ? Math.min(0, min) : min;
  let hi = includeZero ? Math.max(0, max) : max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (hi === lo) {
    hi = lo + 1;
    if (!includeZero) lo -= 1;
  }
  const rough = (hi - lo) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));

  let chosen = { start: lo, end: hi, step: hi - lo };
  for (const multiplier of MULTIPLIERS) {
    const step = multiplier * magnitude;
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    chosen = { start, end, step };
    if (Math.round((end - start) / step) + 1 <= count + 1) break;
  }

  const ticks: number[] = [];
  for (let value = chosen.start; value <= chosen.end + chosen.step / 2; value += chosen.step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

/** Ticks for a set of possibly-null series values. */
export function ticksFor(
  values: Iterable<number | null>,
  options?: Parameters<typeof niceTicks>[2],
): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? [0, 1] : niceTicks(min, max, options);
}
