"use client";

import { useEffect, useState } from "react";

/**
 * Explains a long first load instead of leaving a silent skeleton. The backend runs on a free
 * plan that sleeps when idle, so the first visit after a quiet spell can take about a minute.
 */
export function SlowLoadHint({ afterMs = 6_000 }: { afterMs?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), afterMs);
    return () => window.clearTimeout(id);
  }, [afterMs]);

  if (!visible) return null;
  return (
    <p role="status" className="rise text-sm leading-relaxed text-ink-2">
      Still loading. The data service sleeps when nobody is using it and can take up to a minute to
      wake up. Everything will appear here on its own.
    </p>
  );
}
