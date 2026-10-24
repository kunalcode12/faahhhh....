"""HTTP middleware, written as plain ASGI callables to keep per-request overhead low.

Stack, outermost first (see `build_middleware`):

    RequestContextMiddleware   request id, timing, access log, security headers,
                               last-resort 500 handler
    CORSMiddleware             (Starlette)
    RateLimitMiddleware        per-client token bucket -> 429
    GZipMiddleware             (Starlette)
    HttpCacheMiddleware        ETag + If-None-Match -> 304, Cache-Control
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from urllib.parse import parse_qsl, urlencode

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.errors import problem_response
from app.core.logging import request_id_var
from app.core.rate_limit import RateLimitMiddleware, client_ip

logger = logging.getLogger("app.access")

_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")
_DOCS_PATHS = ("/api/docs", "/api/redoc")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, trust_proxy: bool, hsts: bool) -> None:
        self.app = app
        self.trust_proxy = trust_proxy
        self.hsts = hsts

    def _security_headers(self, path: str) -> dict[str, str]:
        headers = {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
        }
        # The API only serves JSON; Swagger UI needs to load its own scripts.
        if not path.startswith(_DOCS_PATHS):
            headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if self.hsts:
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("x-request-id")
        request_id = incoming if incoming and _REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                headers["Server-Timing"] = f"app;dur={(time.perf_counter() - started) * 1000:.1f}"
                for name, value in self._security_headers(scope["path"]).items():
                    if name not in headers:
                        headers[name] = value
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("unhandled error while serving %s", scope["path"])
            if response_started:
                raise
            response = problem_response(
                500,
                "Internal server error",
                "Something went wrong on our side. Quote the request id if you report it.",
                code="internal_error",
            )
            await response(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            path = scope["path"]
            logger.log(
                logging.DEBUG if path.startswith("/api/health") else logging.INFO,
                "%s %s %s",
                scope["method"],
                path,
                status,
                extra={
                    "status": status,
                    "duration_ms": duration_ms,
                    "client": client_ip(scope, trust_proxy=self.trust_proxy),
                },
            )
            request_id_var.reset(token)


def _normalised_query(query_string: bytes) -> str:
    pairs = parse_qsl(query_string.decode("latin-1"), keep_blank_values=True)
    return urlencode(sorted(pairs))


def _etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    if header.strip() == "*":
        return True
    # If-None-Match uses weak comparison: W/"x" matches "x".
    wanted = etag.removeprefix("W/")
    return any(tag.strip().removeprefix("W/") == wanted for tag in header.split(","))


class ResponseCache:
    """Byte-bounded LRU of rendered response bodies, keyed by ETag."""

    def __init__(self, max_bytes: int) -> None:
        self.max_bytes = max_bytes
        self.size = 0
        self._entries: OrderedDict[str, tuple[list[tuple[bytes, bytes]], bytes]] = OrderedDict()

    def get(self, key: str) -> tuple[list[tuple[bytes, bytes]], bytes] | None:
        entry = self._entries.get(key)
        if entry is not None:
            self._entries.move_to_end(key)
        return entry

    def put(self, key: str, headers: list[tuple[bytes, bytes]], body: bytes) -> None:
        if len(body) > self.max_bytes // 8 or key in self._entries:
            return  # one giant response must not flush everything else
        self._entries[key] = (headers, body)
        self.size += len(body)
        while self.size > self.max_bytes:
            _, (_, evicted) = self._entries.popitem(last=False)
            self.size -= len(evicted)


class HttpCacheMiddleware:
    """Conditional GETs and a rendered-response cache for the data endpoints.

    Every data response is a pure function of (dataset version, URL), so its
    ETag can be computed from those two alone, *before* the endpoint runs:

    - a client revalidating something it already holds gets a 304 with zero work;
    - a URL this worker has already rendered is answered from memory, skipping
      routing, validation and JSON serialisation;
    - Cache-Control lets a CDN answer repeat requests without reaching us at all.

    A new dataset means a new version, hence new keys: nothing stale is served.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        version_getter: Callable[[], str | None],
        max_age: int,
        shared_max_age: int,
        cache_bytes: int,
        prefix: str = "/api/v1/",
    ) -> None:
        self.app = app
        self.version_getter = version_getter
        self.prefix = prefix
        self.bodies = ResponseCache(cache_bytes) if cache_bytes > 0 else None
        self.cache_control = (
            f"public, max-age={max_age}, s-maxage={shared_max_age}, "
            f"stale-while-revalidate={shared_max_age}"
        )

    def _etag(self, version: str, scope: Scope) -> str:
        key = f"{version}|{scope['path']}|{_normalised_query(scope.get('query_string', b''))}"
        digest = hashlib.blake2b(key.encode(), digest_size=10).hexdigest()
        return f'W/"{version[:12]}-{digest}"'

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] not in ("GET", "HEAD")
            or not scope["path"].startswith(self.prefix)
        ):
            await self.app(scope, receive, send)
            return

        version = self.version_getter()
        if version is None:  # dataset not loaded: the endpoint will answer 503
            await self.app(scope, receive, send)
            return

        etag = self._etag(version, scope)
        if _etag_matches(Headers(scope=scope).get("if-none-match"), etag):
            await send(
                {
                    "type": "http.response.start",
                    "status": 304,
                    "headers": [
                        (b"etag", etag.encode()),
                        (b"cache-control", self.cache_control.encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": b""})
            return

        cacheable = self.bodies is not None and scope["method"] == "GET"
        if cacheable and self.bodies is not None and (hit := self.bodies.get(etag)):
            headers, body = hit
            
            await send({"type": "http.response.start", "status": 200, "headers": list(headers)})
            await send({"type": "http.response.body", "body": body})
            return

        start_headers: list[tuple[bytes, bytes]] | None = None
        chunks: list[bytes] = []

        async def send_wrapper(message: Message) -> None:
            nonlocal start_headers
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if message["status"] == 200:
                    headers["ETag"] = etag
                    headers["Cache-Control"] = self.cache_control
                    if cacheable:
                        start_headers = list(message["headers"])
                elif "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            elif message["type"] == "http.response.body" and start_headers is not None:
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False) and self.bodies is not None:
                    self.bodies.put(etag, start_headers, b"".join(chunks))
            await send(message)

        await self.app(scope, receive, send_wrapper)


def build_middleware(
    settings: Settings, version_getter: Callable[[], str | None]
) -> list[Middleware]:
    """The middleware stack, outermost first."""
    return [
        Middleware(
            RequestContextMiddleware,
            trust_proxy=settings.trust_proxy_headers,
            hsts=settings.is_production,
        ),
        Middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "HEAD", "OPTIONS"],
            allow_headers=["Accept", "Content-Type", "If-None-Match", "X-Request-ID"],
            expose_headers=[
                "X-Request-ID",
                "ETag",
                "Retry-After",
                "RateLimit-Limit",
                "RateLimit-Remaining",
                "Server-Timing",
            ],
            max_age=600,
        ),
        Middleware(
            RateLimitMiddleware,
            per_minute=settings.rate_limit_per_minute,
            burst=settings.rate_limit_burst,
            trust_proxy=settings.trust_proxy_headers,
        ),
        # Level 6 is ~3x faster than Starlette's default 9 for ~5% larger output.
        Middleware(GZipMiddleware, minimum_size=1024, compresslevel=6),
        Middleware(
            HttpCacheMiddleware,
            version_getter=version_getter,
            max_age=settings.cache_max_age_seconds,
            shared_max_age=settings.cache_shared_max_age_seconds,
            cache_bytes=settings.response_cache_mb * 1024 * 1024,
        ),
    ]
