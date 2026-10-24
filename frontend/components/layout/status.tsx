"use client";

import { useIsFetching } from "@tanstack/react-query";

import { useOnline } from "@/lib/hooks/use-online";

/** A thin bar under the header while any request is in flight. */
export function FetchProgress() {
  const fetching = useIsFetching();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
      {fetching > 0 ? <div className="progress-bar h-full w-1/3 rounded-full bg-ink/60" /> : null}
    </div>
  );
}

/** Shown while the browser is offline. Queries pause and resume on reconnect. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-ink px-5 py-2.5 text-center text-sm font-semibold text-page">
      You&apos;re offline. Showing what&apos;s already loaded; everything refreshes when you reconnect.
    </div>
  );
}
