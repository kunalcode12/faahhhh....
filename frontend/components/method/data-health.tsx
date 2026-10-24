"use client";

import { useQuery } from "@tanstack/react-query";

import { metaQuery } from "@/lib/api/queries";
import { formatDateShort, formatPct, ukDayTime } from "@/lib/format";

import { ErrorPanel } from "../ui/error-panel";
import { Skeleton } from "../ui/skeleton";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-line py-2.5 first:border-t-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular text-right font-bold">{value}</dd>
    </div>
  );
}

/** Live facts about the loaded dataset, straight from /meta. */
export function DataHealth() {
  const meta = useQuery(metaQuery());
  if (meta.isPending) return <Skeleton className="h-72 rounded-3xl" />;
  if (meta.isError) {
    return <ErrorPanel error={meta.error} onRetry={() => void meta.refetch()} retrying={meta.isFetching} />;
  }
  const { coverage, dataset } = meta.data;
  const q = dataset.quality;
  return (
    <dl className="rounded-3xl border border-line bg-surface px-6 py-3 text-sm">
      <Row
        label="Purchase decisions covered"
        value={`${formatDateShort(coverage.decision_date_from)} – ${formatDateShort(coverage.decision_date_to)}`}
      />
      <Row
        label="Delivery days"
        value={`${formatDateShort(coverage.delivery_date_from)} – ${formatDateShort(coverage.delivery_date_to)}`}
      />
      <Row
        label="Outturn history loaded from"
        value={formatDateShort(dataset.actual_days_from)}
      />
      <Row
        label="Settlement periods metered"
        value={`${q.actual_periods_present.toLocaleString("en-GB")} of ${q.actual_periods_expected.toLocaleString("en-GB")} (${formatPct(q.actual_periods_present / Math.max(1, q.actual_periods_expected), 1)})`}
      />
      <Row
        label="Forecast runs"
        value={`${q.forecast_vintages.toLocaleString("en-GB")} runs, ${q.forecast_points.toLocaleString("en-GB")} values`}
      />
      <Row label="Longest gap between runs" value={`${q.max_vintage_gap_hours} h`} />
      <Row
        label="Rows dropped in cleaning"
        value={`${q.duplicate_rows_dropped} duplicate, ${q.invalid_rows_dropped} invalid`}
      />
      <Row label="Data fetched" value={ukDayTime(dataset.generated_at)} />
      <Row label="Dataset version" value={dataset.version} />
    </dl>
  );
}
