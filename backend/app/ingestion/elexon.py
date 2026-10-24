"""Async client for the Elexon Insights (BMRS) API.

Resilience rules follow the API's documented responses:

- 429 Too Many Requests and 5xx are transient: retry with exponential backoff
  and full jitter, honouring `Retry-After` when the server sends one.
- Network errors and timeouts are transient too: retried the same way.
- 400 and other 4xx mean the request itself is wrong: fail immediately, since
  retrying would only hammer a public API.

Long windows are split into chunks fetched concurrently, bounded by a
semaphore so we stay polite to a shared public service.
"""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from types import TracebackType
from typing import Any, Self

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from app import __version__
from app.core.errors import UpstreamError

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
MAX_RETRY_AFTER_SECONDS = 60.0


class FuelHHRow(BaseModel):
    """One FUELHH stream row. Every field is nullable upstream, so validation is
    permissive here and incomplete rows are dropped (and counted) later."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    publish_time: datetime | None = Field(default=None, alias="publishTime")
    start_time: datetime | None = Field(default=None, alias="startTime")
    settlement_date: date | None = Field(default=None, alias="settlementDate")
    settlement_period: int | None = Field(default=None, alias="settlementPeriod")
    fuel_type: str | None = Field(default=None, alias="fuelType")
    generation: float | None = None


class WindForRow(BaseModel):
    """One WINDFOR stream row."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    publish_time: datetime | None = Field(default=None, alias="publishTime")
    start_time: datetime | None = Field(default=None, alias="startTime")
    generation: float | None = None


_FUELHH_ROWS = TypeAdapter(list[FuelHHRow])
_WINDFOR_ROWS = TypeAdapter(list[WindForRow])


def _iso_z(ts: datetime) -> str:
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_chunks(first: date, last: date, size_days: int) -> list[tuple[date, date]]:
    """Split an inclusive date range into inclusive chunks of at most `size_days`."""
    chunks: list[tuple[date, date]] = []
    start = first
    while start <= last:
        end = min(last, start + timedelta(days=size_days - 1))
        chunks.append((start, end))
        start = end + timedelta(days=1)
    return chunks


def time_chunks(start: datetime, end: datetime, size: timedelta) -> list[tuple[datetime, datetime]]:
    """Split `[start, end]` into back-to-back windows (shared edges are deduplicated later)."""
    chunks: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        upper = min(end, cursor + size)
        chunks.append((cursor, upper))
        cursor = upper
    return chunks


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return min(MAX_RETRY_AFTER_SECONDS, max(0.0, float(value)))
    except ValueError:  # an HTTP-date; rare enough to fall back to our own backoff
        return None


class ElexonClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 30.0,
        max_attempts: int = 5,
        concurrency: int = 4,
        chunk_days: int = 7,
        backoff_base: float = 0.5,
        backoff_cap: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout, connect=10.0),
            headers={"Accept": "application/json", "User-Agent": f"beaufort/{__version__}"},
            limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
            transport=transport,
        )
        self._semaphore = asyncio.Semaphore(concurrency)
        self._max_attempts = max_attempts
        self._chunk_days = chunk_days
        self._backoff_base = backoff_base
        self._backoff_cap = backoff_cap
        self._sleep = sleep

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    # --- datasets ------------------------------------------------------------------

    async def wind_outturn(self, first_day: date, last_day: date) -> list[FuelHHRow]:
        """FUELHH wind outturn for settlement dates `first_day..last_day` (inclusive)."""
        chunks = day_chunks(first_day, last_day, self._chunk_days)
        results = await asyncio.gather(*(self._fuelhh(a, b) for a, b in chunks))
        return [row for chunk in results for row in chunk]

    async def wind_forecasts(
        self, published_from: datetime, published_to: datetime
    ) -> list[WindForRow]:
        """Every WINDFOR vintage published within `[published_from, published_to]`."""
        chunks = time_chunks(published_from, published_to, timedelta(days=self._chunk_days))
        results = await asyncio.gather(*(self._windfor(a, b) for a, b in chunks))
        return [row for chunk in results for row in chunk]

    async def _fuelhh(self, first: date, last: date) -> list[FuelHHRow]:
        body = await self._get(
            "/datasets/FUELHH/stream",
            {
                "settlementDateFrom": first.isoformat(),
                "settlementDateTo": last.isoformat(),
                "fuelType": "WIND",
            },
        )
        return self._parse(_FUELHH_ROWS, body, "FUELHH")

    async def _windfor(self, start: datetime, end: datetime) -> list[WindForRow]:
        body = await self._get(
            "/datasets/WINDFOR/stream",
            {"publishDateTimeFrom": _iso_z(start), "publishDateTimeTo": _iso_z(end)},
        )
        return self._parse(_WINDFOR_ROWS, body, "WINDFOR")

    @staticmethod
    def _parse[T](adapter: TypeAdapter[list[T]], body: bytes, dataset: str) -> list[T]:
        try:
            return adapter.validate_json(body)
        except ValidationError as exc:
            raise UpstreamError(
                f"Elexon returned an unexpected {dataset} payload.",
                extra={"dataset": dataset, "validation_errors": exc.error_count()},
            ) from exc

    # --- transport -----------------------------------------------------------------

    def _backoff(self, attempt: int) -> float:
        """Exponential backoff with full jitter (spreads retries out across clients)."""
        return random.uniform(0, min(self._backoff_cap, self._backoff_base * 2 ** (attempt - 1)))

    async def _get(self, path: str, params: dict[str, str]) -> bytes:
        async with self._semaphore:
            for attempt in range(1, self._max_attempts + 1):
                last_attempt = attempt == self._max_attempts
                try:
                    response = await self._http.get(path, params=params)
                except httpx.TransportError as exc:
                    if last_attempt:
                        raise UpstreamError(
                            f"Could not reach Elexon after {attempt} attempts."
                        ) from exc
                    delay = self._backoff(attempt)
                    logger.warning(
                        "elexon transport error, retrying",
                        extra={
                            "path": path,
                            "attempt": attempt,
                            "delay_s": round(delay, 2),
                            "error": type(exc).__name__,
                        },
                    )
                    await self._sleep(delay)
                    continue

                if response.status_code == 200:
                    return response.content

                if response.status_code in RETRYABLE_STATUS and not last_attempt:
                    delay = _retry_after_seconds(response) or self._backoff(attempt)
                    logger.warning(
                        "elexon transient error, retrying",
                        extra={
                            "path": path,
                            "status": response.status_code,
                            "attempt": attempt,
                            "delay_s": round(delay, 2),
                        },
                    )
                    await self._sleep(delay)
                    continue

                raise UpstreamError(
                    f"Elexon returned HTTP {response.status_code} for {path}.",
                    extra={"upstream_status": response.status_code},
                )
        raise AssertionError("unreachable: the loop always returns or raises")
