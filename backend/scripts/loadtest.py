"""Tiny async load generator: N concurrent clients hammering a mix of endpoints.

    python scripts/loadtest.py --base http://127.0.0.1:8000 --seconds 15 --concurrency 64

Reports throughput and latency percentiles per endpoint. Not a replacement for
k6 or Locust, but enough to sanity-check capacity without extra dependencies.
Run several copies in parallel if one Python process becomes the bottleneck.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import time
from collections import defaultdict

import httpx

DAYS = [f"2026-01-{d:02d}" for d in range(2, 32)] + ["2026-02-01"]
GATES = ["09:20", "09:50", "15:30"]


def pick() -> tuple[str, str, dict[str, str]]:
    """A request mix roughly like a desk using the app: mostly day-ahead views."""
    roll = random.random()
    day = random.choice(DAYS)
    gate = {"gate": random.choice(GATES)}
    if roll < 0.45:
        return "day-ahead", f"/api/v1/day-ahead/{day}", gate
    if roll < 0.60:
        return "vintages", f"/api/v1/day-ahead/{day}/vintages", {}
    if roll < 0.80:
        return "summary", "/api/v1/accuracy/summary", gate
    if roll < 0.92:
        horizon = {"mode": "horizon", "horizon_hours": str(random.randint(0, 48))}
        return "series", "/api/v1/accuracy/series", horizon
    return "meta", "/api/v1/meta", {}


async def worker(
    client: httpx.AsyncClient, until: float, results: dict[str, list[float]], errors: list[int]
) -> None:
    while time.perf_counter() < until:
        name, path, params = pick()
        started = time.perf_counter()
        response = await client.get(path, params=params, headers={"Accept-Encoding": "gzip"})
        results[name].append((time.perf_counter() - started) * 1000)
        if response.status_code != 200:
            errors.append(response.status_code)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument("--concurrency", type=int, default=64)
    args = parser.parse_args()

    results: dict[str, list[float]] = defaultdict(list)
    errors: list[int] = []
    limits = httpx.Limits(
        max_connections=args.concurrency, max_keepalive_connections=args.concurrency
    )
    async with httpx.AsyncClient(base_url=args.base, limits=limits, timeout=30) as client:
        await client.get("/api/health/ready")
        until = time.perf_counter() + args.seconds
        await asyncio.gather(
            *(worker(client, until, results, errors) for _ in range(args.concurrency))
        )

    total = sum(len(v) for v in results.values())
    print(
        f"{total:,} requests in {args.seconds:.0f}s -> {total / args.seconds:,.0f} req/s, "
        f"{len(errors)} errors, concurrency {args.concurrency}"
    )
    print(f"{'endpoint':<10} {'count':>7} {'p50 ms':>8} {'p95 ms':>8} {'p99 ms':>8}")
    for name, samples in sorted(results.items()):
        q = statistics.quantiles(samples, n=100)
        print(f"{name:<10} {len(samples):>7,} {q[49]:>8.1f} {q[94]:>8.1f} {q[98]:>8.1f}")


if __name__ == "__main__":
    asyncio.run(main())
