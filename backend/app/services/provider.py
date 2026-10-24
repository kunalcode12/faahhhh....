"""Dataset lifecycle: load once, expose readiness, retry in the background.

    start()
      |- snapshot present (auto/snapshot mode) -> load it (well under a second)
      |- otherwise (auto/live mode)            -> fetch from Elexon in a background
      |                                           task, retrying with backoff
      '- snapshot mode, no file                -> stay unavailable (503) and say why

While nothing is loaded, data endpoints answer 503 with Retry-After and the
readiness probe fails, but the process stays up and liveness passes, so an
orchestrator does not restart-loop us while Elexon is having a bad day.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from app.core.config import Settings
from app.core.errors import DatasetUnavailableError
from app.domain.dataset import WindDataset
from app.ingestion.pipeline import SOURCE, IngestWindow, client_from_settings, fetch, to_dataset
from app.ingestion.snapshot import SnapshotError, read_snapshot, write_snapshot
from app.services.accuracy import AccuracyService
from app.services.coverage import Coverage
from app.services.day_ahead import DayAheadService

logger = logging.getLogger(__name__)

Origin = Literal["snapshot", "live", "injected"]
MAX_RETRY_DELAY_SECONDS = 600.0


@dataclass(frozen=True, slots=True)
class ServiceBundle:
    """Everything that depends on one dataset, built together and swapped together."""

    dataset: WindDataset
    coverage: Coverage
    day_ahead: DayAheadService
    accuracy: AccuracyService
    origin: Origin
    loaded_at: datetime

    @classmethod
    def build(cls, dataset: WindDataset, settings: Settings, origin: Origin) -> ServiceBundle:
        coverage = Coverage.from_settings(settings)
        day_ahead = DayAheadService(dataset, coverage)
        return cls(
            dataset=dataset,
            coverage=coverage,
            day_ahead=day_ahead,
            accuracy=AccuracyService(dataset, coverage, day_ahead),
            origin=origin,
            loaded_at=datetime.now(UTC),
        )


class DatasetProvider:
    def __init__(self, settings: Settings, *, dataset: WindDataset | None = None) -> None:
        self._settings = settings
        self._bundle: ServiceBundle | None = None
        self._task: asyncio.Task[None] | None = None
        self.last_error: str | None = None
        if dataset is not None:
            self._install(dataset, "injected")

    # --- state -----------------------------------------------------------------------

    @property
    def ready(self) -> bool:
        return self._bundle is not None

    @property
    def version(self) -> str | None:
        return self._bundle.dataset.version if self._bundle else None

    def bundle(self) -> ServiceBundle:
        if self._bundle is None:
            raise DatasetUnavailableError(
                "Wind data is still loading. Please retry in a few seconds.",
                headers={"Retry-After": "5"},
            )
        return self._bundle

    def _install(self, dataset: WindDataset, origin: Origin) -> None:
        self._bundle = ServiceBundle.build(dataset, self._settings, origin)
        self.last_error = None
        logger.info(
            "dataset ready",
            extra={
                "origin": origin,
                "version": dataset.version,
                "actual_points": dataset.actual_count,
                "forecast_points": dataset.forecast_count,
                "vintages": dataset.vintage_count,
            },
        )

    # --- lifecycle -------------------------------------------------------------------

    async def start(self) -> None:
        if self._bundle is not None:
            return
        mode = self._settings.data_mode
        path = self._settings.snapshot_path

        if mode in ("auto", "snapshot") and path.exists():
            try:
                self._install(await asyncio.to_thread(read_snapshot, path), "snapshot")
                return
            except SnapshotError as exc:
                self.last_error = str(exc)
                logger.exception("could not load snapshot %s", path)
                if mode == "snapshot":
                    return

        if mode == "snapshot":
            self.last_error = self.last_error or f"snapshot not found at {path}"
            logger.error("DATA_MODE=snapshot but no usable snapshot at %s", path)
            return

        # Live fetch takes a few seconds; do it in the background so the server
        # starts accepting connections (and answering health checks) right away.
        self._task = asyncio.create_task(self._load_live_forever(), name="dataset-live-load")

    async def _load_live_forever(self) -> None:
        delay = self._settings.dataset_retry_seconds
        while self._bundle is None:
            try:
                self._install(await self._fetch_live(), "live")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                logger.exception("live dataset load failed; retrying in %.0fs", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, MAX_RETRY_DELAY_SECONDS)

    async def _fetch_live(self) -> WindDataset:
        window = IngestWindow.from_settings(self._settings)
        async with client_from_settings(self._settings) as client:
            data = await fetch(client, window)
        generated_at = datetime.now(UTC)
        target = self._settings.live_cache_path or self._settings.snapshot_path
        try:
            await asyncio.to_thread(
                write_snapshot,
                target,
                data,
                generated_at=generated_at,
                source=SOURCE,
                actual_days=window.actual_days,
                published=window.published,
            )
            logger.info("persisted live fetch to %s", target)
        except OSError as exc:  # read-only filesystem etc. - serving matters more
            logger.warning("could not persist snapshot to %s: %s", target, exc)
        return to_dataset(data, generated_at=generated_at, window=window)

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
