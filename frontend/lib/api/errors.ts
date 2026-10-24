/**
 * One error type for everything that can go wrong talking to the API, so the
 * UI and the retry policy can make decisions without string-matching.
 */
export class ApiError extends Error {
  /** HTTP status, or null when no response arrived (network failure, timeout). */
  readonly status: number | null;
  /** Machine-readable code: the API's problem `code`, or a client-side one. */
  readonly code: string;
  readonly requestId: string | null;
  /** From the Retry-After header, when the server asked us to wait. */
  readonly retryAfterMs: number | null;

  constructor(init: {
    message: string;
    code: string;
    status?: number | null;
    requestId?: string | null;
    retryAfterMs?: number | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status ?? null;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }

  /** Transient failures worth retrying automatically. 4xx means "fix the request". */
  get retryable(): boolean {
    if (this.status === null) return this.code === "network_error" || this.code === "timeout";
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export type ErrorCopy = { title: string; message: string; requestId: string | null };

/** Human copy for an error. Never shows stack traces or raw internals. */
export function describeError(error: unknown): ErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: "Something went wrong",
      message: "An unexpected error occurred while showing this section.",
      requestId: null,
    };
  }
  const requestId = error.requestId;
  switch (error.code) {
    case "network_error":
      return { title: "Can't reach the server", message: error.message, requestId };
    case "timeout":
      return { title: "The server is taking too long", message: error.message, requestId };
    case "upstream_unreachable":
      return { title: "The data service is down", message: "We couldn't reach it; it may be restarting. Try again in a moment.", requestId };
    case "upstream_timeout":
      return { title: "The data service is slow", message: error.message, requestId };
    case "upstream_waking":
      return {
        title: "The data service is waking up",
        message: "It sleeps when nobody is using it and takes about a minute to start. Try again in a moment.",
        requestId,
      };
    case "rate_limited":
      return { title: "Too many requests", message: "Slow down a little; retrying shortly.", requestId };
    case "dataset_unavailable":
      return { title: "Data is still loading", message: error.message, requestId };
    case "out_of_coverage":
      return { title: "Outside the data window", message: error.message, requestId };
    case "validation_error":
    case "invalid_request":
      return { title: "That selection isn't valid", message: error.message, requestId };
    case "invalid_response":
      return { title: "Unexpected response", message: error.message, requestId };
    default:
      return {
        title: error.status && error.status >= 500 ? "The server hit a problem" : "Request failed",
        message: error.message,
        requestId,
      };
  }
}
