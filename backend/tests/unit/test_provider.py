"""Dataset lifecycle: snapshot loading, background live fetch, self-healing retries."""

from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path

import httpx
import pytest
import respx

from app.core.config import Settings
from app.core.errors import DatasetUnavailableError
from app.services.provider import DatasetProvider

BASE = "https://elexon.test/bmrs/api/v1"
FUELHH_ROW = {
    "publishTime": "2026-01-02T00:30:00Z",
    "startTime": "2026-01-02T00:00:00Z",
    "settlementDate": "2026-01-02",
    "settlementPeriod": 1,
    "fuelType": "WIND",
    "generation": 9000,
}
WINDFOR_ROW = {
    "publishTime": "2026-01-01T09:30:00Z",
    "startTime": "2026-01-02T00:00:00Z",
    "generation": 9500,
}

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def live_settings(tmp_path: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "log_level": "ERROR",
        "data_mode": "auto",
        "snapshot_path": tmp_path / "snapshot.json.gz",
        "elexon_base_url": BASE,
        "elexon_max_attempts": 1,
        "decision_date_from": date(2026, 1, 1),
        "decision_date_to": date(2026, 1, 1),
        "history_days": 7,
        "dataset_retry_seconds": 0.01,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


async def wait_until_ready(provider: DatasetProvider) -> None:
    async with asyncio.timeout(5):
        while not provider.ready:  # noqa: ASYNC110 - polling a plain flag is fine in a test
            await asyncio.sleep(0.01)


@respx.mock
async def test_auto_mode_fetches_live_in_background_and_persists(tmp_path: Path) -> None:
    respx.get(f"{BASE}/datasets/FUELHH/stream").mock(
        return_value=httpx.Response(200, json=[FUELHH_ROW])
    )
    respx.get(f"{BASE}/datasets/WINDFOR/stream").mock(
        return_value=httpx.Response(200, json=[WINDFOR_ROW])
    )
    settings = live_settings(tmp_path)
    provider = DatasetProvider(settings)

    await provider.start()
    with pytest.raises(DatasetUnavailableError):  # not blocking startup: still loading
        provider.bundle()
    await wait_until_ready(provider)

    assert provider.bundle().origin == "live"
    assert settings.snapshot_path.exists()  # next start loads from disk
    await provider.aclose()

    reloaded = DatasetProvider(settings)
    await reloaded.start()
    assert reloaded.ready
    assert reloaded.bundle().origin == "snapshot"
    assert reloaded.version == provider.version


@respx.mock
async def test_live_failures_are_retried_until_elexon_recovers(tmp_path: Path) -> None:
    calls = 0

    def flaky(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400) if calls == 1 else httpx.Response(200, json=[FUELHH_ROW])

    respx.get(f"{BASE}/datasets/FUELHH/stream").mock(side_effect=flaky)
    respx.get(f"{BASE}/datasets/WINDFOR/stream").mock(return_value=httpx.Response(200, json=[]))
    provider = DatasetProvider(live_settings(tmp_path))

    await provider.start()
    await wait_until_ready(provider)
    assert calls > 2  # the first load failed and a later attempt fetched again
    assert provider.last_error is None
    await provider.aclose()


async def test_snapshot_mode_never_calls_out(tmp_path: Path) -> None:
    provider = DatasetProvider(live_settings(tmp_path, data_mode="snapshot"))
    await provider.start()
    assert not provider.ready
    assert provider.last_error is not None
    assert "snapshot not found" in provider.last_error


async def test_corrupt_snapshot_is_reported(tmp_path: Path) -> None:
    settings = live_settings(tmp_path, data_mode="snapshot")
    settings.snapshot_path.write_bytes(b"definitely not gzip")
    provider = DatasetProvider(settings)
    await provider.start()
    assert not provider.ready
    assert provider.last_error is not None
    assert "cannot read snapshot" in provider.last_error
