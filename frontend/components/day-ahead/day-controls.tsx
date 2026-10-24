"use client";

import type { ReactNode } from "react";

import type { DayAheadParams } from "@/lib/api/queries";
import { cn } from "@/lib/cn";
import { addDays } from "@/lib/dates";
import { formatDateLong, formatDateShort } from "@/lib/format";
import type { GateOption } from "@/lib/hooks/use-desk-meta";
import { FALLBACK, gateLabel, normaliseGate, type Coverage } from "@/lib/params";

import { Segmented } from "../ui/segmented";

function StepButton({
  label,
  disabled,
  onClick,
  onIntent,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  onIntent: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      className="grid size-10 place-items-center rounded-xl text-xl font-bold text-ink transition hover:bg-surface disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export function DayControls({
  params,
  coverage,
  gates,
  onChange,
  onPrefetch,
}: {
  params: DayAheadParams;
  coverage: Coverage;
  gates: readonly GateOption[];
  onChange: (patch: Partial<DayAheadParams>) => void;
  onPrefetch: (date: string) => void;
}) {
  const prev = addDays(params.date, -1);
  const next = addDays(params.date, 1);
  const options = gates.map((g) => ({ value: normaliseGate(g.gate) ?? g.gate, label: g.label, hint: `gate ${g.gate}` }));
  if (!options.some((o) => o.value === params.gate)) {
    options.push({ value: params.gate, label: "Custom", hint: `gate ${gateLabel(params.gate)}` });
  }
  const preset = gates.find((g) => normaliseGate(g.gate) === params.gate);

  return (
    <section aria-label="Delivery day and auction" className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-semibold text-ink-2">Delivery day</p>
        <h1 className="mt-1 text-4xl font-black leading-[1.05] tracking-[-0.035em] sm:text-6xl">
          {formatDateLong(params.date)}
        </h1>
        <p className="mt-3 text-base text-ink-2 sm:text-lg">
          Bids close{" "}
          <strong className="font-bold text-ink">
            {formatDateShort(prev)} at {gateLabel(params.gate)}
          </strong>
          {preset ? ` (${preset.label})` : ""}. The forecast shown is the latest run published before
          then.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-2xl bg-surface-2 p-1">
          <StepButton
            label="Previous delivery day"
            disabled={prev < coverage.from}
            onClick={() => onChange({ date: prev })}
            onIntent={() => onPrefetch(prev)}
          >
            ‹
          </StepButton>
          <input
            type="date"
            aria-label="Delivery day"
            value={params.date}
            min={coverage.from}
            max={coverage.to}
            required
            onChange={(event) => {
              const value = event.target.value;
              if (value && value >= coverage.from && value <= coverage.to) onChange({ date: value });
            }}
            className="tabular h-10 rounded-xl bg-surface px-3 text-sm font-bold text-ink ring-1 ring-line"
          />
          <StepButton
            label="Next delivery day"
            disabled={next > coverage.to}
            onClick={() => onChange({ date: next })}
            onIntent={() => onPrefetch(next)}
          >
            ›
          </StepButton>
        </div>

        <Segmented
          label="Auction gate"
          value={params.gate}
          options={options}
          onChange={(gate) => onChange({ gate })}
        />

        <label className="flex items-center gap-2 rounded-2xl bg-surface-2 py-1 pl-3.5 pr-1 text-sm font-bold text-ink-2">
          Calibration
          <select
            value={params.lookback}
            onChange={(event) => onChange({ lookback: Number(event.target.value) })}
            className={cn("h-10 rounded-xl bg-surface px-2 text-sm font-bold text-ink ring-1 ring-line")}
          >
            {FALLBACK.lookbacks.map((days) => (
              <option key={days} value={days}>
                last {days} days
              </option>
            ))}
          </select>
        </label>

        <p className="hidden text-xs text-muted lg:block">Tip: ← → step through days</p>
      </div>
    </section>
  );
}
