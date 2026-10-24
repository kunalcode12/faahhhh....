import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { apiGet, buildUrl, parseRetryAfter } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { MAX_RETRIES, retryDelay, shouldRetry } from "@/lib/query-client";

const Schema = z.object({ value: z.number() });

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl);
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildUrl", () => {
  it("skips empty parameters", () => {
    expect(buildUrl("/api/v1/x", { a: 1, b: null, c: undefined, d: "", e: "09:50" })).toBe(
      "/api/v1/x?a=1&e=09%3A50",
    );
  });
});

describe("apiGet", () => {
  it("returns validated data", async () => {
    mockFetch(async () => json({ value: 42, extra: "ignored" }));
    await expect(apiGet("/x", {}, Schema)).resolves.toEqual({ value: 42 });
  });

  it("turns problem+json into a typed error", async () => {
    mockFetch(async () =>
      json(
        { code: "out_of_coverage", detail: "Outside the window.", status: 404 },
        { status: 404, headers: { "x-request-id": "req-1" } },
      ),
    );
    const error = await apiGet("/x", {}, Schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "out_of_coverage", requestId: "req-1" });
    expect((error as ApiError).retryable).toBe(false);
    expect(describeError(error).title).toBe("Outside the data window");
  });

  it("reads Retry-After from rate limits", async () => {
    mockFetch(async () => json({ code: "rate_limited", detail: "slow down" }, { status: 429, headers: { "retry-after": "3" } }));
    const error = (await apiGet("/x", {}, Schema).catch((e: unknown) => e)) as ApiError;
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(3000);
  });

  it("survives a non-JSON error page", async () => {
    mockFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = (await apiGet("/x", {}, Schema).catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 502, code: "http_502" });
    expect(error.retryable).toBe(true);
  });

  it("reports network failures as retryable", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = (await apiGet("/x", {}, Schema).catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: "network_error", status: null });
    expect(error.retryable).toBe(true);
  });

  it("rejects responses that break the contract", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => json({ value: "not a number" }));
    const error = (await apiGet("/x", {}, Schema).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("invalid_response");
    expect(error.retryable).toBe(false);
  });

  it("times out", async () => {
    mockFetch((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const error = (await apiGet("/x", {}, Schema, { timeoutMs: 20 }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
  });

  it("lets caller cancellation through untouched", async () => {
    mockFetch((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const controller = new AbortController();
    const pending = apiGet("/x", {}, Schema, { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe("AbortError");
  });
});

describe("retry policy", () => {
  const transient = new ApiError({ message: "x", code: "http_503", status: 503 });
  const permanent = new ApiError({ message: "x", code: "validation_error", status: 422 });

  it("retries only transient failures, a bounded number of times", () => {
    expect(shouldRetry(0, transient)).toBe(true);
    expect(shouldRetry(MAX_RETRIES, transient)).toBe(false);
    expect(shouldRetry(0, permanent)).toBe(false);
    expect(shouldRetry(0, new Error("render bug"))).toBe(false);
  });

  it("backs off exponentially with jitter, honouring Retry-After", () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const ceiling = Math.min(8000, 500 * 2 ** attempt);
      const delay = retryDelay(attempt, transient);
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
    const limited = new ApiError({ message: "x", code: "rate_limited", status: 429, retryAfterMs: 7000 });
    expect(retryDelay(0, limited)).toBe(7000);
  });

  it("parses Retry-After dates as well as seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", Date.parse("2026-01-01T00:00:00Z"))).toBe(10_000);
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
