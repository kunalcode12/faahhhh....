"""Resilience of the Elexon client, with the network mocked out by respx."""

from __future__ import annotations

from datetime import date
from itertools import pairwise

import httpx
import pytest
import respx

from app.core.errors import UpstreamError
from app.ingestion.elexon import ElexonClient, day_chunks, time_chunks
from tests.factories import utc

BASE = "https://elexon.test/bmrs/api/v1"
FUELHH = f"{BASE}/datasets/FUELHH/stream"
ROW = {
    "dataset": "FUELHH",
    "publishTime": "2026-01-15T00:30:00Z",
    "startTime": "2026-01-15T00:00:00Z",
    "settlementDate": "2026-01-15",
    "settlementPeriod": 1,
    "fuelType": "WIND",
    "generation": 12000,
}

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class Sleeps:
    """Records backoff delays instead of actually sleeping."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def client(sleeps: Sleeps, **kwargs: int) -> ElexonClient:
    return ElexonClient(BASE, max_attempts=kwargs.pop("max_attempts", 4), sleep=sleeps, **kwargs)


@respx.mock
async def test_retries_transient_errors_then_succeeds() -> None:
    route = respx.get(FUELHH).mock(
        side_effect=[httpx.Response(503), httpx.Response(502), httpx.Response(200, json=[ROW])]
    )
    sleeps = Sleeps()
    async with client(sleeps) as c:
        rows = await c.wind_outturn(date(2026, 1, 15), date(2026, 1, 15))
    assert [r.generation for r in rows] == [12000]
    assert route.call_count == 3
    assert len(sleeps.calls) == 2


@respx.mock
async def test_honours_retry_after_on_429() -> None:
    respx.get(FUELHH).mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "7"}),
            httpx.Response(200, json=[ROW]),
        ]
    )
    sleeps = Sleeps()
    async with client(sleeps) as c:
        await c.wind_outturn(date(2026, 1, 15), date(2026, 1, 15))
    assert sleeps.calls == [7.0]


@respx.mock
async def test_client_errors_fail_fast_without_retrying() -> None:
    route = respx.get(FUELHH).mock(return_value=httpx.Response(400, json={"error": "bad"}))
    sleeps = Sleeps()
    async with client(sleeps) as c:
        with pytest.raises(UpstreamError, match="HTTP 400"):
            await c.wind_outturn(date(2026, 1, 15), date(2026, 1, 15))
    assert route.call_count == 1
    assert sleeps.calls == []


@respx.mock
async def test_network_errors_are_retried_and_eventually_surface() -> None:
    route = respx.get(FUELHH).mock(side_effect=httpx.ConnectError("boom"))
    sleeps = Sleeps()
    async with client(sleeps, max_attempts=3) as c:
        with pytest.raises(UpstreamError, match="after 3 attempts"):
            await c.wind_outturn(date(2026, 1, 15), date(2026, 1, 15))
    assert route.call_count == 3
    assert len(sleeps.calls) == 2


@respx.mock
async def test_unexpected_payload_is_an_upstream_error() -> None:
    respx.get(FUELHH).mock(return_value=httpx.Response(200, json={"not": "a list"}))
    async with client(Sleeps()) as c:
        with pytest.raises(UpstreamError, match="unexpected FUELHH payload"):
            await c.wind_outturn(date(2026, 1, 15), date(2026, 1, 15))


@respx.mock
async def test_long_ranges_are_fetched_in_chunks() -> None:
    route = respx.get(FUELHH).mock(return_value=httpx.Response(200, json=[]))
    async with client(Sleeps(), chunk_days=7) as c:
        await c.wind_outturn(date(2026, 1, 1), date(2026, 1, 10))
    params = sorted(
        (call.request.url.params["settlementDateFrom"], call.request.url.params["settlementDateTo"])
        for call in route.calls
    )
    assert params == [("2026-01-01", "2026-01-07"), ("2026-01-08", "2026-01-10")]
    assert all(call.request.url.params["fuelType"] == "WIND" for call in route.calls)


def test_chunk_helpers_cover_the_range_exactly() -> None:
    assert day_chunks(date(2026, 1, 1), date(2026, 1, 3), 7) == [
        (date(2026, 1, 1), date(2026, 1, 3))
    ]
    chunks = time_chunks(utc(2026, 1, 1), utc(2026, 1, 20), utc(2026, 1, 8) - utc(2026, 1, 1))
    assert chunks[0][0] == utc(2026, 1, 1)
    assert chunks[-1][1] == utc(2026, 1, 20)
    assert all(a[1] == b[0] for a, b in pairwise(chunks))
