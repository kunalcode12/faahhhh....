import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api/errors";

export const MAX_RETRIES = 3;

/** Retry only what can succeed on a second try: network blips, timeouts, 408/429/5xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  return error instanceof ApiError && error.retryable;
}


export function retryDelay(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, 30_000);
  }
  const ceiling = Math.min(8_000, 500 * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // January 2026 
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
    },
  });
}
