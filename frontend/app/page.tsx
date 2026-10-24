import type { Metadata } from "next";
import { Suspense } from "react";

import { DayAheadSkeleton } from "@/components/day-ahead/day-ahead-skeleton";
import { DayAheadView } from "@/components/day-ahead/day-ahead-view";

// The layout's "%s · Beaufort" template only applies to child segments, not this page.
export const metadata: Metadata = {
  title: { absolute: "Day-ahead · Beaufort" },
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
