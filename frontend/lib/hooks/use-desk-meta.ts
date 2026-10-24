"use client";

import { useQuery } from "@tanstack/react-query";

import { metaQuery } from "@/lib/api/queries";
import { FALLBACK, FALLBACK_GATES, type Coverage } from "@/lib/params";

export type GateOption = { id: string; label: string; gate: string };

/**
 * Coverage and auction presets from /meta, with built-in fallbacks so the
 * page's main request can start immediately instead of waiting on /meta.
 */
export function useDeskMeta() {
  const meta = useQuery(metaQuery());
  const coverage: Coverage = meta.data
    ? { from: meta.data.coverage.delivery_date_from, to: meta.data.coverage.delivery_date_to }
    : { from: FALLBACK.deliveryFrom, to: FALLBACK.deliveryTo };
  const gates: readonly GateOption[] = meta.data
    ? meta.data.gates.map(({ id, label, gate }) => ({ id, label, gate }))
    : FALLBACK_GATES;
  return { meta, coverage, gates };
}
