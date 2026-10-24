import type { z } from "zod";

import { ApiError } from "./errors";

const DEFAULT_TIMEOUT_MS = 15_000;

export type QueryParams = Record<string, string | number | null | undefined>;

export function buildUrl(path: string, params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - now);
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  let message = `Request failed with status ${response.status}.`;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const problem = body as { code?: unknown; detail?: unknown };
      if (typeof problem.code === "string") code = problem.code;
      if (typeof problem.detail === "string") message = problem.detail;
    }
  } catch {
    // Not JSON (e.g. a proxy's HTML error page): keep the generic message.
  }
  return new ApiError({
    message,
    code,
    status: response.status,
    requestId: response.headers.get("x-request-id"),
    retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
  });
}

/** Combine the caller's cancel signal with a timeout, remembering which fired. */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return { signal: timeout, timedOut: () => timeout.aborted };
  if (typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any([signal, timeout]), timedOut: () => timeout.aborted };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, timedOut: () => timeout.aborted };
}

export async function apiGet<T>(
  path: string,
  params: QueryParams,
  schema: z.ZodType<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const { signal, timedOut } = withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timeoutError = () =>
    new ApiError({ code: "timeout", message: "The server took too long to respond. Retrying usually helps." });

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (timedOut()) throw timeoutError();
    if (options.signal?.aborted) throw error;
    throw new ApiError({
      code: "network_error",
      message: "Could not reach the server. Check your connection; we'll keep trying.",
    });
  }

  if (!response.ok) throw await errorFromResponse(response);

  const requestId = response.headers.get("x-request-id");
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (timedOut()) throw timeoutError();
    if (options.signal?.aborted) throw error;
    throw new ApiError({
      code: "invalid_response",
      status: response.status,
      requestId,
      message: "The server sent a response that could not be read.",
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(`[api] ${path}: response failed validation`, parsed.error.issues.slice(0, 5));
    throw new ApiError({
      code: "invalid_response",
      status: response.status,
      requestId,
      message: "The server's response did not match what this app expects.",
    });
  }
  return parsed.data;
}
