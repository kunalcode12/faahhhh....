import type { Metadata } from "next";
import { Suspense } from "react";

import { DayAheadSkeleton } from "@/components/day-ahead/day-ahead-skeleton";
import { DayAheadView } from "@/components/day-ahead/day-ahead-view";

export const metadata: Metadata = {
  title: "Day-ahead",
};

/**
 * The static shell (header, skeleton) is prerendered and served instantly.
 * The view reads the URL and fetches in the browser, so it sits behind
 * Suspense as Cache Components requires.
 */
export default function DayAheadPage() {
  return (
    <Suspense fallback={<DayAheadSkeleton />}>
      <DayAheadView />
    </Suspense>
  );
}
