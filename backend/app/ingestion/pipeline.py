"""Ingestion pipeline: work out the window, fetch, normalise, build a dataset.

decisions in scope -> IngestWindow -> ElexonClient (FUELHH + WINDFOR, in parallel)
                   -> normalize() -> NormalizedData -> WindDataset / snapshot file
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.core.config import Settings
from app.domain.dataset import DatasetInfo, WindDataset
from app.domain.settlement import delivery_day_bounds
from app.ingestion.elexon import ElexonClient
from app.ingestion.normalize import NormalizedData, normalize

SOURCE = "Elexon Insights API (BMRS): FUELHH wind outturn + WINDFOR wind forecast"

# Fetch forecast runs this far before the first history day, so 48h+ lead-time
# analysis and the forecast-evolution view have complete coverage.
FORECAST_PREFETCH = timedelta(days=3)


@dataclass(frozen=True, slots=True)
class IngestWindow:
    actual_days: tuple[date, date]  # settlement (delivery) dates, UK local, inclusive
    published: tuple[datetime, datetime]  # forecast publish times, UTC, inclusive

    @classmethod
    def for_decisions(
        cls, decision_from: date, decision_to: date, history_days: int
    ) -> IngestWindow:
        """Data needed to support purchase decisions made between the two dates.

        A decision on day X buys power for delivery day X+1. On top of the
        delivery days themselves we fetch `history_days` of settled days before
        the first one: the trailing window calibration learns from, exactly
        the history a trader would have had on their desk at the time.
        """
        first_delivery = decision_from + timedelta(days=1)
        last_delivery = decision_to + timedelta(days=1)
        history_start = first_delivery - timedelta(days=history_days)
        return cls(
            actual_days=(history_start, last_delivery),
            published=(
                delivery_day_bounds(history_start)[0] - FORECAST_PREFETCH,
                delivery_day_bounds(last_delivery)[1],
            ),
        )

    @classmethod
    def from_settings(cls, settings: Settings) -> IngestWindow:
        return cls.for_decisions(
            settings.decision_date_from, settings.decision_date_to, settings.history_days
        )


async def fetch(client: ElexonClient, window: IngestWindow) -> NormalizedData:
    fuel_rows, forecast_rows = await asyncio.gather(
        client.wind_outturn(*window.actual_days),
        client.wind_forecasts(*window.published),
    )
    return normalize(
        fuel_rows, forecast_rows, actual_days=window.actual_days, published=window.published
    )


def to_dataset(
    data: NormalizedData, *, generated_at: datetime, window: IngestWindow
) -> WindDataset:
    info = DatasetInfo(
        generated_at=generated_at,
        source=SOURCE,
        actual_days=window.actual_days,
        forecast_published=window.published,
        quality=data.quality,
    )
    return WindDataset(data.actuals, data.forecasts, info)


def client_from_settings(settings: Settings) -> ElexonClient:
    return ElexonClient(
        settings.elexon_base_url,
        timeout=settings.elexon_timeout_seconds,
        max_attempts=settings.elexon_max_attempts,
        concurrency=settings.elexon_concurrency,
        chunk_days=settings.elexon_chunk_days,
    )
