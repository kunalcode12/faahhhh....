// @vitest-environment node
import { describe, expect, it } from "vitest";

import { forward, type ForwardOptions } from "@/lib/proxy";

const URL_ = new URL("http://backend.test/api/v1/meta");

function json(status = 200) {
  return new Response('{"ok":true}', { status, headers: { "content-type": "application/json" } });
}
function holdingPage(status = 200) {
  return new Response("<html>Service waking up…</html>", { status, headers: { "content-type": "text/html" } });
}

function options(responses: Array<Response | Error>, overrides: Partial<ForwardOptions> = {}) {
  const queue = [...responses];
  let calls = 0;
  const opts: ForwardOptions = {
    budgetMs: 10_000,
    wakeRetryMs: 10,
    expectJson: true,
    signal: new AbortController().signal,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      const next = queue.shift() ?? json();
      if (next instanceof Error) throw next;
      return next;
    },
    ...overrides,
  };
  return { opts, calls: () => calls };
}

describe("forward (backend asleep on a free plan)", () => {
  it("passes a normal JSON answer straight through", async () => {
    const { opts, calls } = options([json()]);
    const result = await forward(URL_, new Headers(), opts);
    expect(result.kind).toBe("response");
    expect(calls()).toBe(1);
  });

  it("waits through holding pages and platform 503s until the API answers", async () => {
    const { opts, calls } = options([holdingPage(), holdingPage(503), json()]);
    const result = await forward(URL_, new Headers(), opts);
    expect(result.kind).toBe("response");
    expect(calls()).toBe(3);
  });

  it("gives up with 'waking' when the budget runs out", async () => {
    const { opts } = options(Array.from({ length: 50 }, () => holdingPage()), { budgetMs: 1_000, wakeRetryMs: 100 });
    expect((await forward(URL_, new Headers(), opts)).kind).toBe("waking");
  });

  it("never mistakes our own JSON errors or 304s for a sleeping backend", async () => {
    const problem = new Response('{"code":"dataset_unavailable"}', {
      status: 503,
      headers: { "content-type": "application/problem+json" },
    });
    expect((await forward(URL_, new Headers(), options([problem]).opts)).kind).toBe("response");
    expect((await forward(URL_, new Headers(), options([new Response(null, { status: 304 })]).opts)).kind).toBe(
      "response",
    );
  });

  it("lets HTML pages like /api/docs through", async () => {
    const { opts } = options([holdingPage()], { expectJson: false });
    expect((await forward(URL_, new Headers(), opts)).kind).toBe("response");
  });

  it("reports an unreachable backend at once instead of waiting", async () => {
    const { opts, calls } = options([new TypeError("fetch failed")]);
    expect((await forward(URL_, new Headers(), opts)).kind).toBe("unreachable");
    expect(calls()).toBe(1);
  });

  it("stops when the browser cancels", async () => {
    const controller = new AbortController();
    controller.abort();
    const { opts } = options([new DOMException("aborted", "AbortError")], { signal: controller.signal });
    expect((await forward(URL_, new Headers(), opts)).kind).toBe("aborted");
  });
});
