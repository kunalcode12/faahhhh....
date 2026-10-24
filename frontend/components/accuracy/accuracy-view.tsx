"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  accuracySeriesQuery,
  accuracySummaryQuery,
  horizonCurveQuery,
  type AccuracyParams,
} from "@/lib/api/queries";
import type { AccuracySeries } from "@/lib/api/schemas";
import { formatDateShort, formatHours, formatMW, formatPct, formatSignedPower, ukDayTime } from "@/lib/format";
import { useDeskMeta } from "@/lib/hooks/use-desk-meta";
import { useUrlParams } from "@/lib/hooks/use-url-params";
import { insightsFor } from "@/lib/insights";
import { gateLabel, parseAccuracy } from "@/lib/params";

import { ErrorHistogram, HourOfDayChart, LeadTimeChart, LevelBiasChart } from "../charts/error-charts";
import { ChartCard, COLORS, DataTable, Legend } from "../charts/kit";
import { SeriesChart } from "../charts/series-chart";
import { ErrorPanel } from "../ui/error-panel";
import { QuerySection } from "../ui/query-section";
import { SectionBoundary } from "../ui/section-boundary";
import { AccuracyControls } from "./accuracy-controls";
import { AccuracyHeadlineSkeleton } from "./accuracy-skeleton";
import { AccuracyHeadline, InsightList } from "./accuracy-summary";
import { DailyTable } from "./daily-table";

const HORIZON_COMMIT_MS = 200;

function describe(params: AccuracyParams): string {
  const window = `${formatDateShort(params.from)} to ${formatDateShort(params.to)}`;
  return params.mode === "gate"
    ? `Scoring the forecast you could actually bid on - the latest run before the ${gateLabel(params.gate)} gate the day before - for delivery ${window}.`
    : `Scoring the latest run published at least ${params.horizon} h before each hour, for delivery ${window}.`;
}

function SeriesTable({ series }: { series: AccuracySeries }) {
  return (
    <DataTable
      rows={series.forecasts}
      rowKey={(f) => f.start_time}
      caption="Hourly forecast and outturn"
      columns={[
        { header: "Hour (UK)", cell: (f) => ukDayTime(f.start_time) },
        { header: "NESO forecast", cell: (f) => formatMW(f.forecast_mw), align: "right" },
        { header: "Actual", cell: (f) => (f.actual_mw === null ? "–" : formatMW(f.actual_mw)), align: "right" },
        {
          header: "Error",
          cell: (f) => (f.actual_mw === null ? "–" : formatSignedPower(f.forecast_mw - f.actual_mw)),
          align: "right",
        },
        { header: "Lead time", cell: (f) => formatHours(f.horizon_hours), align: "right" },
      ]}
    />
  );
}

export function AccuracyView() {
  const [search, setSearch] = useUrlParams();
  const { coverage, gates } = useDeskMeta();
  const { from, to } = coverage;
  const params = useMemo(() => parseAccuracy(search, { from, to }), [search, from, to]);

  const change = useCallback(
    (patch: Partial<AccuracyParams>, options?: { replace?: boolean }) => {
      const m = { ...params, ...patch };
      const gateMode = m.mode === "gate";
      setSearch(
        {
          from: m.from,
          to: m.to,
          mode: m.mode,
          gate: gateMode ? m.gate : null,
          lookback: gateMode ? m.lookback : null,
          h: gateMode ? null : m.horizon,
        },
        options,
      );
    },
    [params, setSearch],
  );

  // The slider label follows the thumb instantly; the URL (and so the request)
  // only updates once the user pauses, instead of on every pixel of a drag.
  const [horizonDraft, setHorizonDraft] = useState<number | null>(null);
  const commitTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(commitTimer.current), []);
  const onHorizon = (hours: number) => {
    setHorizonDraft(hours);
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      change({ horizon: hours }, { replace: true });
      setHorizonDraft(null);
    }, HORIZON_COMMIT_MS);
  };

  const summary = useQuery({ ...accuracySummaryQuery(params), placeholderData: keepPreviousData });
  const series = useQuery({ ...accuracySeriesQuery(params), placeholderData: keepPreviousData });
  const curve = useQuery({ ...horizonCurveQuery(params), placeholderData: keepPreviousData });

  const insights = useMemo(
    () => (summary.data ? insightsFor(summary.data, curve.data) : []),
    [summary.data, curve.data],
  );
  const leadWindow = params.mode === "gate" ? (summary.data?.lead_time_hours ?? null) : null;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold text-ink-2">Forecast accuracy</p>
        <h1 className="mt-1 text-4xl font-black leading-[1.05] tracking-[-0.035em] sm:text-6xl">
          How far can you trust the forecast?
        </h1>
        <p className="mt-3 max-w-3xl text-base text-ink-2 sm:text-lg">{describe(params)}</p>
      </header>

      <AccuracyControls
        params={params}
        coverage={coverage}
        gates={gates}
        horizon={horizonDraft ?? params.horizon}
        onChange={change}
        onHorizon={onHorizon}
      />

      {summary.isPending ? (
        <AccuracyHeadlineSkeleton />
      ) : summary.isError ? (
        <ErrorPanel error={summary.error} onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
      ) : (
        <>
          <SectionBoundary>
            <div className={summary.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <AccuracyHeadline summary={summary.data} />
            </div>
          </SectionBoundary>
          <SectionBoundary>
            <InsightList insights={insights} />
          </SectionBoundary>
        </>
      )}

      <SectionBoundary>
        <QuerySection query={series} skeletonClassName="h-[500px]">
          {(data, dimmed) => (
            <ChartCard
              title="Forecast vs outturn"
              subtitle={
                params.mode === "gate"
                  ? "Each hour shows the run that was available at the gate the day before, against what was metered."
                  : `Each hour shows the latest run published at least ${params.horizon} h before it.`
              }
              dimmed={dimmed}
              legend={
                <Legend
                  entries={[
                    { key: "actual", label: "Actual outturn", color: COLORS.actual, kind: "line" },
                    { key: "forecast", label: "NESO forecast", color: COLORS.forecast, kind: "line" },
                  ]}
                />
              }
              table={<SeriesTable series={data} />}
              footnote="Outturn is metered every half-hour; NESO forecasts are hourly, so errors are scored on the hour."
            >
              <SeriesChart series={data} />
            </ChartCard>
          )}
        </QuerySection>
      </SectionBoundary>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionBoundary>
          <QuerySection query={curve} skeletonClassName="h-[420px]">
            {(data, dimmed) => (
              <ChartCard
                title="Error by lead time"
                subtitle="Every run, scored by how far ahead it was published - not just the latest. The shaded band is where day-ahead bids sit."
                dimmed={dimmed}
                legend={
                  <Legend
                    entries={[
                      { key: "mae", label: "Mean absolute error", color: COLORS.forecast, kind: "line" },
                      { key: "p90", label: "1-in-10 miss (P90)", color: COLORS.deemph, kind: "line" },
                    ]}
                  />
                }
                table={
                  <DataTable
                    rows={data.buckets}
                    rowKey={(b) => String(b.horizon_hours)}
                    caption="Error by lead time"
                    columns={[
                      { header: "Lead time", cell: (b) => `${b.horizon_hours}–${b.horizon_hours + 1} h` },
                      { header: "Mean abs. error", cell: (b) => formatMW(b.mae_mw), align: "right" },
                      { header: "P90 miss", cell: (b) => formatMW(b.p90_abs_mw), align: "right" },
                      { header: "Bias", cell: (b) => formatSignedPower(b.bias_mw), align: "right" },
                      { header: "Forecasts", cell: (b) => b.count, align: "right" },
                    ]}
                  />
                }
              >
                <LeadTimeChart curve={data} window={leadWindow} />
              </ChartCard>
            )}
          </QuerySection>
        </SectionBoundary>

        <SectionBoundary>
          <QuerySection query={summary} skeletonClassName="h-[420px]">
            {(data, dimmed) => (
              <ChartCard
                title="When in the day it misses"
                subtitle="Mean absolute error by hour of delivery, UK time."
                dimmed={dimmed}
                table={
                  <DataTable
                    rows={data.by_hour}
                    rowKey={(h) => String(h.hour)}
                    caption="Error by hour of day"
                    columns={[
                      { header: "Hour", cell: (h) => `${String(h.hour).padStart(2, "0")}:00` },
                      { header: "Mean abs. error", cell: (h) => formatMW(h.mae_mw), align: "right" },
                      { header: "Bias", cell: (h) => formatSignedPower(h.bias_mw), align: "right" },
                      { header: "P90 miss", cell: (h) => formatMW(h.p90_abs_mw), align: "right" },
                    ]}
                  />
                }
              >
                <HourOfDayChart rows={data.by_hour} />
              </ChartCard>
            )}
          </QuerySection>
        </SectionBoundary>

        <SectionBoundary>
          <QuerySection query={summary} skeletonClassName="h-[420px]">
            {(data, dimmed) => (
              <ChartCard
                title="Over-promise by wind level"
                subtitle="Average bias, grouped by how much wind the forecast promised (GW). Taller bars: more of the promised wind went missing."
                dimmed={dimmed}
                table={
                  <DataTable
                    rows={data.by_level}
                    rowKey={(b) => String(b.lower_mw)}
                    caption="Bias by forecast level"
                    columns={[
                      { header: "Forecast", cell: (b) => `${b.lower_mw / 1000}–${b.upper_mw / 1000} GW` },
                      { header: "Bias", cell: (b) => formatSignedPower(b.bias_mw), align: "right" },
                      { header: "Outturn / forecast", cell: (b) => formatPct(b.realisation_rate), align: "right" },
                      { header: "Hours", cell: (b) => b.count, align: "right" },
                    ]}
                  />
                }
              >
                <LevelBiasChart rows={data.by_level} />
              </ChartCard>
            )}
          </QuerySection>
        </SectionBoundary>

        <SectionBoundary>
          <QuerySection query={summary} skeletonClassName="h-[420px]">
            {(data, dimmed) => (
              <ChartCard
                title="Which way it misses"
                subtitle="How many hours fell into each 0.5 GW band of error (forecast minus actual)."
                dimmed={dimmed}
                legend={
                  <Legend
                    entries={[
                      { key: "over", label: "Forecast too high: you'd be short", color: COLORS.forecast, kind: "bar" },
                      { key: "under", label: "Forecast too low", color: COLORS.deemph, kind: "bar" },
                    ]}
                  />
                }
                table={
                  <DataTable
                    rows={data.distribution}
                    rowKey={(b) => String(b.lower_mw)}
                    caption="Distribution of forecast errors"
                    columns={[
                      {
                        header: "Error band",
                        cell: (b) => `${formatSignedPower(b.lower_mw)} to ${formatSignedPower(b.upper_mw)}`,
                      },
                      { header: "Hours", cell: (b) => b.count, align: "right" },
                    ]}
                  />
                }
              >
                <ErrorHistogram bins={data.distribution} />
              </ChartCard>
            )}
          </QuerySection>
        </SectionBoundary>
      </div>

      {summary.data ? (
        <SectionBoundary>
          <DailyTable summary={summary.data} dimmed={summary.isPlaceholderData} />
        </SectionBoundary>
      ) : null}
    </div>
  );
}
