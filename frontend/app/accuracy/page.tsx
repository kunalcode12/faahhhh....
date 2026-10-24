import type { Metadata } from "next";
import { Suspense } from "react";

import { AccuracySkeleton } from "@/components/accuracy/accuracy-skeleton";
import { AccuracyView } from "@/components/accuracy/accuracy-view";

export const metadata: Metadata = {
  title: "Accuracy",
  description: "How accurate the NESO day-ahead wind forecast was, by lead time, hour and wind level.",
};

export default function AccuracyPage() {
  return (
    <Suspense fallback={<AccuracySkeleton />}>
      <AccuracyView />
    </Suspense>
  );
}
