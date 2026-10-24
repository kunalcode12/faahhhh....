import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type SeriesKey = "actual" | "forecast" | "calibrated";

const swatches: Record<SeriesKey, string> = {
  actual: "bg-actual",
  forecast: "bg-forecast",
  calibrated: "bg-calibrated",
};

/**
 * A headline number. The value uses proportional figures (big numbers look
 * loose with tabular ones). A short line key ties it to its chart series;
 * the text itself always stays in ink colours.
 */
export function Stat({
  label,
  value,
  detail,
  series,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  series?: SeriesKey;
  className?: string;
}) {
  return (
    <div className={cn("rounded-3xl border border-line bg-surface p-5", className)}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-2">
        {series ? <span aria-hidden className={cn("h-[3px] w-4 rounded-full", swatches[series])} /> : null}
        {label}
      </p>
      <p className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{value}</p>
      {detail ? <p className="mt-1.5 text-sm leading-snug text-ink-2">{detail}</p> : null}
    </div>
  );
}
