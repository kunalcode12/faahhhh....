/**
 * Backend-for-frontend proxy: the browser only ever calls its own origin
 * (/api/...), so there is no CORS and the backend address never ships to the client.
 *
 * On Vercel Services the platform routes /api/* straight to the FastAPI service
 * and this handler is never reached. Everywhere else (local dev, Docker, a
 * separate backend host) it forwards to BACKEND_URL, read at request time so
 * one build works in every environment.
 */

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const TIMEOUT_MS = 20_000;

// Only the API surface is reachable through the proxy.
const ALLOWED = /^(v1\/.+|health\/(live|ready)|docs|redoc|openapi\.json)$/;

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

function problem(status: number, code: string, title: string, detail: string): Response {
  return Response.json(
    { type: `https://beaufort.app/problems/${code}`, title, status, detail, code, request_id: null },
    { status, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } },
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

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return timedOut
      ? problem(504, "upstream_timeout", "Backend timed out", "The data service took too long to answer.")
      : problem(502, "upstream_unreachable", "Backend unreachable", "The data service could not be reached.");
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  // 304 (ETag revalidation) and 204 must not carry a body, or Response() throws.
  const body = upstream.status === 304 || upstream.status === 204 ? null : upstream.body;
  return new Response(body, { status: upstream.status, headers: out });
}
