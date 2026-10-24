"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { dayAheadQuery, vintagesQuery, type DayAheadParams } from "@/lib/api/queries";
import { addDays } from "@/lib/dates";
import { useArrowKeys } from "@/lib/hooks/use-arrow-keys";
import { useDeskMeta } from "@/lib/hooks/use-desk-meta";
import { useUrlParams } from "@/lib/hooks/use-url-params";
import { gateLabel, normaliseGate, parseDayAhead } from "@/lib/params";

import { ChartCard, COLORS, Legend } from "../charts/kit";
import { DayProfileChart } from "../charts/day-profile-chart";
import { ErrorPanel } from "../ui/error-panel";
import { SectionBoundary } from "../ui/section-boundary";
import { Skeleton } from "../ui/skeleton";
import { DaySummarySkeleton } from "./day-ahead-skeleton";
import { DayControls } from "./day-controls";
import { DaySummary } from "./day-summary";
import { HourTable } from "./hour-table";
import { RunsPanel } from "./runs-panel";

export function DayAheadView() {
  const [search, setSearch] = useUrlParams();
  const { coverage, gates } = useDeskMeta();
  const { from, to } = coverage;
  const params = useMemo(() => parseDayAhead(search, { from, to }), [search, from, to]);
  const queryClient = useQueryClient();

  // Keep showing the previous day (dimmed) while the next one loads: no flash.
  const day = useQuery({ ...dayAheadQuery(params), placeholderData: keepPreviousData });
  const runs = useQuery({ ...vintagesQuery(params), placeholderData: keepPreviousData });

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const toggleSeries = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Write the full state to the URL so every view is a complete, shareable link.
  const change = useCallback(
    (patch: Partial<DayAheadParams>) => {
      const merged = { ...params, ...patch };
      setSearch({ date: merged.date, gate: merged.gate, lookback: merged.lookback });
    },
    [params, setSearch],
  );

  const prefetch = useCallback(
    (date: string) => {
      if (date < from || date > to) return;
      void queryClient.prefetchQuery(dayAheadQuery({ ...params, date }));
      void queryClient.prefetchQuery(vintagesQuery({ ...params, date }));
    },
    [from, to, params, queryClient],
  );

  const prev = addDays(params.date, -1);
  const next = addDays(params.date, 1);
  useArrowKeys(
    () => {
      if (prev >= from) change({ date: prev });
    },
    () => {
      if (next <= to) change({ date: next });
    },
  );

  // Once a day has loaded, quietly warm its neighbours so stepping feels instant.
  const loaded = day.isSuccess && !day.isPlaceholderData;
  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => {
      prefetch(prev);
      prefetch(next);
    }, 300);
    return () => window.clearTimeout(id);
  }, [loaded, prefetch, prev, next]);

  const gateName = gates.find((g) => normaliseGate(g.gate) === params.gate)?.label ?? gateLabel(params.gate);

  return (
    <div className="space-y-8">
      <DayControls params={params} coverage={coverage} gates={gates} onChange={change} onPrefetch={prefetch} />

      {day.isPending ? (
        <>
          <DaySummarySkeleton />
          <Skeleton className="h-[520px] rounded-3xl" />
        </>
      ) : day.isError ? (
        <ErrorPanel error={day.error} onRetry={() => void day.refetch()} retrying={day.isFetching} />
      ) : (
        <>
          <SectionBoundary>
            <div className={day.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <DaySummary day={day.data} gateName={gateName} />
            </div>
          </SectionBoundary>

          <SectionBoundary>
            <ChartCard
              title="Hour by hour"
              subtitle="NESO's forecast as published before the gate, our calibrated forecast with its 80% range, and the metered outturn every half-hour."
              dimmed={day.isPlaceholderData}
              legend={
                <Legend
                  onToggle={toggleSeries}
                  entries={[
                    { key: "actual", label: "Actual outturn", color: COLORS.actual, kind: "line", hidden: hidden.has("actual") },
                    { key: "forecast", label: "NESO forecast at gate", color: COLORS.forecast, kind: "line", hidden: hidden.has("forecast") },
                    { key: "calibrated", label: "Calibrated + 80% range", color: COLORS.calibrated, kind: "line", hidden: hidden.has("calibrated") },
                  ]}
                />
              }
              table={<HourTable day={day.data} />}
              footnote={day.data.notes.join(" ")}
            >
              <DayProfileChart day={day.data} hidden={hidden} />
            </ChartCard>
          </SectionBoundary>
        </>
      )}

      <SectionBoundary>
        <RunsPanel query={runs} />
      </SectionBoundary>
    </div>
  );
}
