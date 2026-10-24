"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
 * Shared chart chrome. Colours are CSS variables, so every chart follows
 * light/dark mode automatically. Each entity keeps one colour app-wide.
 */
export const COLORS = {
  actual: "var(--actual)",
  forecast: "var(--forecast)",
  calibrated: "var(--calibrated)",
  band: "var(--band)",
  deemph: "var(--deemph)",
  deemph2: "var(--deemph-2)",
  grid: "var(--grid)",
  axis: "var(--axis)",
  muted: "var(--muted)",
  surface: "var(--surface)",
  ink: "var(--ink)",
} as const;

export const AXIS_TICK = { fill: COLORS.muted, fontSize: 12 } as const;
export const AXIS_LINE = { stroke: COLORS.axis } as const;
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 } as const;

/** Axis unit, set in HTML above the plot so it can never collide with a tick label. */
export function AxisUnit({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-xs font-semibold text-muted">{children}</p>;
}

// --- legend -------------------------------------------------------------------------

export type LegendEntry = {
  key: string;
  label: string;
  color: string;
  kind: "line" | "area" | "dot" | "ring" | "bar";
  hidden?: boolean;
};

function LegendKey({ entry }: { entry: LegendEntry }) {
  const common = { backgroundColor: entry.color };
  if (entry.kind === "line") return <span aria-hidden className="h-[3px] w-5 rounded-full" style={common} />;
  if (entry.kind === "dot") return <span aria-hidden className="size-2.5 rounded-full" style={common} />;
  if (entry.kind === "ring") {
    return <span aria-hidden className="size-2.5 rounded-full border-2" style={{ borderColor: entry.color }} />;
  }
  if (entry.kind === "bar") return <span aria-hidden className="h-3 w-2.5 rounded-[3px]" style={common} />;
  return <span aria-hidden className="h-3 w-5 rounded-[3px]" style={common} />;
}

/** Legend that mirrors the marks; entries can toggle their series when `onToggle` is given. */
export function Legend({
  entries,
  onToggle,
}: {
  entries: readonly LegendEntry[];
  onToggle?: (key: string) => void;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
      {entries.map((entry) => {
        const content = (
          <>
            <LegendKey entry={entry} />
            <span className={cn(entry.hidden && "line-through opacity-60")}>{entry.label}</span>
          </>
        );
        return (
          <li key={entry.key}>
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(entry.key)}
                aria-pressed={!entry.hidden}
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:text-ink"
              >
                {content}
              </button>
            ) : (
              <span className="flex items-center gap-2 px-1 py-0.5">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- tooltip ------------------------------------------------------------------------

/** Tooltip shell: values lead (strong), labels follow (secondary), line keys not boxes. */
export function TooltipCard({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-w-56 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
      <p className="text-xs font-semibold text-ink-2">{title}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
      {footer ? <p className="mt-2 border-t border-line pt-2 text-xs text-muted">{footer}</p> : null}
    </div>
  );
}

export function TooltipRow({ color, label, value }: { color?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 text-sm">
      <span className="flex items-center gap-2 text-ink-2">
        {color ? <span aria-hidden className="h-[3px] w-3 rounded-full" style={{ backgroundColor: color }} /> : null}
        {label}
      </span>
      <span className="tabular font-bold text-ink">{value}</span>
    </div>
  );
}

// --- table view ---------------------------------------------------------------------

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
};

/** The accessible twin of a chart: every plotted value, readable without hovering. */
export function DataTable<T>({
  rows,
  columns,
  caption,
  rowKey,
  maxHeight = "28rem",
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  caption: string;
  rowKey: (row: T, index: number) => string;
  maxHeight?: string;
}) {
  return (
    <div className="overflow-auto rounded-2xl border border-line" style={{ maxHeight }}>
      <table className="tabular w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-2 text-left text-xs font-semibold text-ink-2">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={cn("whitespace-nowrap px-3 py-2.5", column.align === "right" && "text-right")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-t border-line hover:bg-surface-2/60">
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={cn("whitespace-nowrap px-3 py-2", column.align === "right" && "text-right")}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- card -------------------------------------------------------------------------

/**
 * A chart's frame: title, legend, a chart/table toggle and an optional footnote.
 * While a refetch is in flight (`dimmed`) the previous render stays visible at
 * reduced opacity - no skeleton flash, no layout jump.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  actions,
  footnote,
  dimmed = false,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  table?: ReactNode;
  actions?: ReactNode;
  footnote?: ReactNode;
  dimmed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const titleId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      className={cn("rise rounded-3xl border border-line bg-surface p-5 sm:p-6", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-xl font-extrabold tracking-tight sm:text-2xl">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {table ? (
            <button
              type="button"
              onClick={() => setView(view === "chart" ? "table" : "chart")}
              aria-pressed={view === "table"}
              className="rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-ink-2 transition hover:bg-surface-2 hover:text-ink"
            >
              {view === "chart" ? "Table" : "Chart"}
            </button>
          ) : null}
        </div>
      </div>
      {legend && view === "chart" ? <div className="mt-4">{legend}</div> : null}
      <div className={cn("mt-4 transition-opacity duration-300", dimmed && "opacity-50")}>
        {view === "chart" || !table ? children : table}
      </div>
      {footnote ? <figcaption className="mt-3 text-xs leading-relaxed text-muted">{footnote}</figcaption> : null}
    </figure>
  );
}
