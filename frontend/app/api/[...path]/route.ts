/**
 * Backend-for-frontend proxy: the browser only ever calls its own origin
 * (/api/...), so there is no CORS and the backend address never ships to the client.
 *
 * Forwards to BACKEND_URL (the Render service in production, :8000 locally),
 * read at request time so one build works in every environment. If the
 * backend is asleep (Render free plan), lib/proxy.ts waits for it to wake.
 */

import { forward } from "@/lib/proxy";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
// Time spent on one browser request, across retries while the backend wakes.
// The browser's own timeout (lib/api/client.ts) is longer, so this answers first.
const BUDGET_MS = 25_000;
const WAKE_RETRY_MS = 3_000;

// Let the platform run this handler long enough to ride out a cold start.
export const maxDuration = 60;

// Only the API surface is reachable through the proxy.
const ALLOWED = /^(v1\/.+|health\/(live|ready)|docs|redoc|openapi\.json)$/;
const HTML_PAGES = /^(docs|redoc)$/;

const FORWARD_REQUEST_HEADERS = ["accept", "if-none-match", "x-request-id"];
// Not content-encoding/length: fetch() has already decompressed the body.
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "retry-after",
  "x-request-id",
  "ratelimit-limit",
  "ratelimit-remaining",
  "server-timing",
];

function problem(
  status: number,
  code: string,
  title: string,
  detail: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { type: `https://beaufort.app/problems/${code}`, title, status, detail, code, request_id: null },
    {
      status,
      headers: { "content-type": "application/problem+json", "cache-control": "no-store", ...extraHeaders },
    },
  );
}

export async function GET(request: Request, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const target = path.join("/");
  if (!ALLOWED.test(target)) {
    return problem(404, "not_found", "Not found", "No such API endpoint.");
  }

  const url = new URL(`/api/${target}`, BACKEND_URL);
  url.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp = request.headers.get("x-forwarded-for");
  if (clientIp) headers.set("x-forwarded-for", clientIp);

  const result = await forward(url, headers, {
    budgetMs: BUDGET_MS,
    wakeRetryMs: WAKE_RETRY_MS,
    expectJson: !HTML_PAGES.test(target),
    signal: request.signal,
  });

  switch (result.kind) {
    case "aborted":
      return new Response(null, { status: 499 });
    case "timeout":
      return problem(504, "upstream_timeout", "Backend timed out", "The data service took too long to answer.");
    case "unreachable":
      return problem(502, "upstream_unreachable", "Backend unreachable", "The data service could not be reached.");
    case "waking":
      return problem(
        503,
        "upstream_waking",
        "Data service waking up",
        "The data service was asleep and is starting up; this takes about a minute.",
        { "retry-after": "5" },
      );
    case "response": {
      const upstream = result.response;
      const out = new Headers();
      for (const name of FORWARD_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) out.set(name, value);
      }
      // 304 (ETag revalidation) and 204 must not carry a body, or Response() throws.
      const body = upstream.status === 304 || upstream.status === 204 ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: out });
    }
  }
}
