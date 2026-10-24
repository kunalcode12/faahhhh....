"use client";

import type { AccuracyParams } from "@/lib/api/queries";
import { formatDayMonth } from "@/lib/format";
import type { GateOption } from "@/lib/hooks/use-desk-meta";
import { FALLBACK, normaliseGate, rangePresets, type Coverage } from "@/lib/params";

import { Segmented } from "../ui/segmented";

const fieldClass = "h-10 rounded-xl bg-surface px-3 text-sm font-bold text-ink ring-1 ring-line";

export function AccuracyControls({
  params,
  coverage,
  gates,
  horizon,
  onChange,
  onHorizon,
}: {
  params: AccuracyParams;
  coverage: Coverage;
  gates: readonly GateOption[];
  horizon: number;
  onChange: (patch: Partial<AccuracyParams>) => void;
  onHorizon: (hours: number) => void;
}) {
  const presets = rangePresets(coverage);
  const active = presets.find((p) => p.from === params.from && p.to === params.to)?.id ?? "custom";
  const rangeOptions = presets.map((p) => ({
    value: p.id,
    label: p.label,
    hint: `${formatDayMonth(p.from)}–${formatDayMonth(p.to)}`,
  }));
  if (active === "custom") {
    rangeOptions.push({
      value: "custom",
      label: "Custom",
      hint: `${formatDayMonth(params.from)}–${formatDayMonth(params.to)}`,
    });
  }

  return (
    <section aria-label="What to score" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Delivery days"
          value={active}
          options={rangeOptions}
          onChange={(id) => {
            const preset = presets.find((p) => p.id === id);
            if (preset) onChange({ from: preset.from, to: preset.to });
          }}
        />
        <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-1 text-sm font-bold text-ink-2">
          <input
            type="date"
            aria-label="First delivery day"
            className={`tabular ${fieldClass}`}
            value={params.from}
            min={coverage.from}
            max={params.to}
            onChange={(e) => e.target.value && onChange({ from: e.target.value })}
          />
          <span aria-hidden>to</span>
          <input
            type="date"
            aria-label="Last delivery day"
            className={`tabular ${fieldClass}`}
            value={params.to}
            min={params.from}
            max={coverage.to}
            onChange={(e) => e.target.value && onChange({ to: e.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Which forecast to score"
          value={params.mode}
          options={[
            { value: "gate", label: "At the auction gate", hint: "the run you bid on" },
            { value: "horizon", label: "Fixed lead time", hint: "0–48 h ahead" },
          ]}
          onChange={(mode) => onChange({ mode })}
        />

        {params.mode === "gate" ? (
          <>
            <Segmented
              label="Auction gate"
              value={params.gate}
              options={gates.map((g) => ({
                value: normaliseGate(g.gate) ?? g.gate,
                label: g.label,
                hint: `gate ${g.gate}`,
              }))}
              onChange={(gate) => onChange({ gate })}
            />
            <label className="flex items-center gap-2 rounded-2xl bg-surface-2 py-1 pl-3.5 pr-1 text-sm font-bold text-ink-2">
              Calibration
              <select
                value={params.lookback}
                onChange={(e) => onChange({ lookback: Number(e.target.value) })}
                className={fieldClass}
              >
                {FALLBACK.lookbacks.map((days) => (
                  <option key={days} value={days}>
                    last {days} days
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-2 text-sm font-bold text-ink-2">
            Published at least
            <input
              type="range"
              min={0}
              max={FALLBACK.maxHorizon}
              step={1}
              value={horizon}
              onChange={(e) => onHorizon(Number(e.target.value))}
              aria-valuetext={`${horizon} hours before the target`}
              className="w-40 sm:w-56"
            />
            <span className="tabular w-16 text-right text-lg font-black text-ink">{horizon} h</span>
            ahead
          </label>
        )}
      </div>
    </section>
  );
}
