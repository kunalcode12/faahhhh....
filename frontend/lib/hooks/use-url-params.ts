"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type ParamPatch = Record<string, string | number | null>;

/**
 * Read and update the query string without a server round trip.
 *
 * Uses the native History API, which Next.js keeps in sync with
 * `useSearchParams`. Discrete choices push a history entry (so Back undoes
 * them); continuous ones like a slider replace it instead of flooding history.
 */
export function useUrlParams() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const update = useCallback(
    (patch: ParamPatch, { replace = false }: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, String(value));
      }
      const query = next.toString();
      if (query === searchParams.toString()) return;
      const url = query ? `${pathname}?${query}` : pathname;
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
    },
    [pathname, searchParams],
  );

  return [searchParams, update] as const;
}
