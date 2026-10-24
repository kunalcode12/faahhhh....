/**
 * Server-side forwarding to the FastAPI backend, used by app/api/[...path]/route.ts.
 *
 * The backend runs on Render's free plan, which sleeps after 15 minutes without traffic and
 * takes about a minute to wake. While it wakes, a request may hang, get a 502/503/504 from the
 * platform, or get an HTML holding page instead of our JSON. `forward()` keeps trying within a
 * time budget, so the user usually gets data rather than an error.
 */

export type ForwardResult =
  | { kind: "response"; response: Response }
  | { kind: "waking" } // still not answering with our API after the budget
  | { kind: "timeout" }
  | { kind: "unreachable" }
  | { kind: "aborted" }; // the browser went away

export type ForwardOptions = {
  /** Total time to spend on this request, across attempts. */
  budgetMs: number;
  /** Pause between attempts while the backend is waking up. */
  wakeRetryMs: number;
  /** False for HTML endpoints such as /api/docs, which are never mistaken for a holding page. */
  expectJson: boolean;
  /** The incoming browser request's signal: stop as soon as it is cancelled. */
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/** Our API always answers JSON (or 304). Anything else came from the platform, not from us. */
function looksAsleep(response: Response, expectJson: boolean): boolean {
  if (!expectJson || response.status === 304) return false;
  return !(response.headers.get("content-type") ?? "").includes("json");
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function forward(url: URL, headers: Headers, options: ForwardOptions): Promise<ForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + options.budgetMs;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { kind: "timeout" };

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(remaining)]),
      });
    } catch (error) {
      if (options.signal.aborted) return { kind: "aborted" };
      if (error instanceof DOMException && error.name === "TimeoutError") return { kind: "timeout" };
      return { kind: "unreachable" };
    }

    if (!looksAsleep(response, options.expectJson)) return { kind: "response", response };

    await response.body?.cancel();
    if (deadline - Date.now() < options.wakeRetryMs + 1_000) return { kind: "waking" };
    await sleep(options.wakeRetryMs);
    if (options.signal.aborted) return { kind: "aborted" };
  }
}
