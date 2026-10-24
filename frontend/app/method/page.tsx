import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { DataHealth } from "@/components/method/data-health";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Method",
  description: "How Beaufort picks the forecast, calibrates it and measures its accuracy.",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t border-line py-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <h2 id={id} className="text-2xl font-extrabold tracking-tight">
        {title}
      </h2>
      <div className="max-w-3xl space-y-4 leading-relaxed text-ink-2 [&_strong]:font-bold [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

const METRICS: Array<[string, string]> = [
  ["Error", "Forecast minus actual, per hour. Positive means the forecast promised more wind than came, so the desk would be short."],
  ["Mean absolute error (MAE)", "The typical size of a miss, ignoring direction. The headline number."],
  ["Bias", "The average signed error. A persistent bias is fixable; that is what calibration does."],
  ["RMSE", "Like MAE but squares errors first, so big misses weigh more."],
  ["WAPE", "Total absolute error divided by total wind delivered: MAE as a share of the energy."],
  ["P90 / P99 miss", "Nine (or 99) hours in ten (a hundred) miss by less than this. Sizes the tail risk."],
  ["Range coverage", "Share of hours whose outturn fell inside the P10-P90 range. An honest 80% range covers about 80%."],
];

export default function MethodPage() {
  return (
    <article>
      <header className="pb-10">
        <p className="text-sm font-semibold text-ink-2">Method</p>
        <h1 className="mt-1 max-w-4xl text-4xl font-black leading-[1.05] tracking-[-0.035em] sm:text-6xl">
          What the numbers mean, and where they come from
        </h1>
      </header>

      <Section id="decision" title="The decision">
        <p>
          A UK supplier buys tomorrow&apos;s power in the GB day-ahead auctions, which close the morning
          before delivery: <strong>EPEX&apos;s 60-minute auction at 09:20</strong>,{" "}
          <strong>Nord Pool&apos;s N2EX at 09:50</strong> and <strong>EPEX&apos;s 30-minute auction at 15:30</strong>{" "}
          (all UK time). What it needs to buy is roughly demand minus what renewables will supply, so the
          wind forecast in hand at that moment drives the volume.
        </p>
        <p>
          A purchase decision made on day X is for delivery on day X+1. Decisions made in January 2026
          therefore cover <strong>delivery days 2 January to 1 February 2026</strong>.
        </p>
      </Section>

      <Section id="selection" title="Which forecast counts">
        <p>
          NESO publishes a national wind forecast (Elexon&apos;s WINDFOR dataset) about eight times a day.
          Each run gives hourly values roughly three days ahead. For a delivery day, Beaufort uses{" "}
          <strong>the latest run published strictly before the auction gate</strong> on the day before. A
          run landing at the exact moment of the gate is too late to act on, so it doesn&apos;t count.
        </p>
        <p>
          The accuracy page can also score a <strong>fixed lead time</strong>: for every hour, the latest
          run published at least H hours earlier. That separates &ldquo;how good is the forecast?&rdquo;
          from &ldquo;which run did the auction timing leave me with?&rdquo;
        </p>
        <p>
          Forecasts are hourly; metered outturn (Elexon&apos;s FUELHH, wind) is half-hourly. Errors are
          scored at the top of each hour, where both exist. Nothing is interpolated.
        </p>
      </Section>

      <Section id="calibration" title="Calibration and the 80% range">
        <p>
          January&apos;s data shows the published forecast running high, and more so on windy days:
          metered output topped out near 18 GW while forecasts reached 21 GW. That is consistent with wind
          being curtailed by grid constraints. A scale factor captures it far better than a fixed offset.
        </p>
        <p>
          For each delivery day, Beaufort looks back over the <strong>last 14 fully metered days</strong>{" "}
          (configurable). It only uses days that had been metered by the gate, so nothing from the future
          leaks in. From those days it learns two things:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            the <strong>realisation rate</strong>, actual over forecast energy. The calibrated forecast is
            the published one times this rate;
          </li>
          <li>
            the spread of the remaining errors. Their 10th and 90th percentiles become the{" "}
            <strong>P10-P90 range</strong>.
          </li>
        </ul>
        <p>
          Back-tested over January at the 09:50 gate, this cut the typical hourly miss from about{" "}
          <strong>2.0 GW to 1.3 GW</strong>, and about <strong>82%</strong> of hours landed inside the 80%
          range. P10 is the &ldquo;wind you can count on&rdquo; figure: 9 hours in 10 should deliver at
          least that much.
        </p>
      </Section>

      <Section id="metrics" title="How accuracy is measured">
        <dl className="divide-y divide-line rounded-3xl border border-line bg-surface">
          {METRICS.map(([term, definition]) => (
            <div key={term} className="grid gap-1 px-5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="font-bold text-ink">{term}</dt>
              <dd>{definition}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="data" title="The data">
        <p>
          Everything comes from the Elexon Insights API: <strong>FUELHH</strong> (half-hourly outturn,
          fuel type WIND) and <strong>WINDFOR</strong> (every published forecast run). Rows are validated,
          de-duplicated and checked for gaps on the way in.
        </p>
        <Suspense fallback={<Skeleton className="h-72 rounded-3xl" />}>
          <DataHealth />
        </Suspense>
      </Section>

      <Section id="limits" title="Limits worth knowing">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            National level only. FUELHH counts transmission-metered wind, so wind embedded in local
            networks shows up as lower demand rather than as wind.
          </li>
          <li>
            No demand or price data. The tool sizes the wind side of the decision; the volume to buy still
            needs the desk&apos;s demand forecast.
          </li>
          <li>
            Calibration assumes the last few weeks resemble tomorrow. A sudden change, such as new
            transmission capacity, takes the lookback window to wash through.
          </li>
          <li>
            The curtailment explanation is an inference from the data, not something Elexon publishes
            here.
          </li>
        </ul>
      </Section>
    </article>
  );
}
