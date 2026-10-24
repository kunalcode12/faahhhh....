"""Per-client token-bucket rate limiting.

Each client gets a bucket of `burst` tokens that refills at `per_minute / 60`
tokens per second; every request spends one. That allows short bursts (a page
load fires several requests at once) while capping sustained load.

State is in-process, so with N workers a client effectively gets N buckets.
That is fine as abuse protection for this app; a shared limit across instances
would move the buckets into Redis behind the same `hit()` interface.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import problem_response


class TokenBucketLimiter:
    def __init__(self, per_minute: int, burst: int, *, max_clients: int = 100_000) -> None:
        self.rate = per_minute / 60.0
        self.burst = float(burst)
        self.max_clients = max_clients
        self._buckets: dict[str, tuple[float, float]] = {}

    def hit(self, key: str, now: float) -> tuple[bool, int, float]:
        """Spend one token. Returns (allowed, tokens_left, seconds_until_next_token)."""
        tokens, updated = self._buckets.get(key, (self.burst, now))
        tokens = min(self.burst, tokens + (now - updated) * self.rate)
        if tokens >= 1.0:
            tokens -= 1.0
            allowed, retry_after = True, 0.0
        else:
            allowed, retry_after = False, (1.0 - tokens) / self.rate
        self._buckets[key] = (tokens, now)
        if len(self._buckets) > self.max_clients:
            self._evict_idle(now)
        return allowed, int(tokens), retry_after

    def _evict_idle(self, now: float) -> None:
        # A bucket that has had time to refill completely carries no state.
        refill_seconds = self.burst / self.rate
        self._buckets = {k: v for k, v in self._buckets.items() if now - v[1] < refill_seconds}


def client_ip(scope: Scope, *, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = Headers(scope=scope).get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    client = scope.get("client")
    return str(client[0]) if client else "unknown"


class RateLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        per_minute: int,
        burst: int,
        trust_proxy: bool,
        exempt_prefixes: tuple[str, ...] = ("/api/health",),
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.app = app
        self.enabled = per_minute > 0
        self.limiter = TokenBucketLimiter(per_minute, burst) if self.enabled else None
        self.limit = burst
        self.trust_proxy = trust_proxy
        self.exempt_prefixes = exempt_prefixes
        self.clock = clock

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or self.limiter is None
            or scope["method"] == "OPTIONS"
            or scope["path"].startswith(self.exempt_prefixes)
        ):
            await self.app(scope, receive, send)
            return

        key = client_ip(scope, trust_proxy=self.trust_proxy)
        allowed, remaining, retry_after = self.limiter.hit(key, self.clock())
        if not allowed:
            wait = max(1, math.ceil(retry_after))
            response = problem_response(
                429,
                "Too many requests",
                f"Rate limit exceeded. Try again in {wait} second(s).",
                code="rate_limited",
                headers={
                    "Retry-After": str(wait),
                    "RateLimit-Limit": str(self.limit),
                    "RateLimit-Remaining": "0",
                },
            )
            await response(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["RateLimit-Limit"] = str(self.limit)
                headers["RateLimit-Remaining"] = str(remaining)
            await send(message)

        await self.app(scope, receive, send_with_headers)
