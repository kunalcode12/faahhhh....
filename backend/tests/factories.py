"""Deterministic synthetic data shaped like the real Elexon feeds.

- Outturn: half-hourly, a smooth daily cycle around 10 GW.
- Forecast runs: eight a day at the real publish times, each covering 73 hours
  from 21:00 the day before publication, like WINDFOR.
- Forecast value = `ratio` x actual, so error statistics have known answers
  (ratio 1.25 -> every hour over-forecast by 25%, realisation rate 0.8).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta

from app.domain.dataset import DataQuality, DatasetInfo, WindDataset
from app.domain.models import ActualPoint, ForecastPoint
from app.domain.settlement import (
    SETTLEMENT_PERIOD,
    delivery_day_bounds,
    iter_days,
    settlement_periods_in,
)

PUBLISH_TIMES = (
    time(2, 30),
    time(4, 30),
    time(7, 30),
    time(9, 30),
    time(11, 30),
    time(15, 30),
    time(18, 30),
    time(22, 30),
)
RUN_LENGTH_HOURS = 73
OVER_FORECAST = 1.25


def actual_mw(ts: datetime) -> float:
    return 10_000 + 2_000 * math.sin(2 * math.pi * (ts.hour + ts.minute / 60) / 24)


def utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=UTC)  # type: ignore[misc]


def empty_quality() -> DataQuality:
    return DataQuality(
        actual_periods_expected=0,
        actual_periods_present=0,
        missing_actual_periods=(),
        forecast_vintages=0,
        forecast_points=0,
        max_vintage_gap_hours=0.0,
        duplicate_rows_dropped=0,
        invalid_rows_dropped=0,
    )


def make_dataset(
    actuals: list[ActualPoint], forecasts: list[ForecastPoint], *, first: date, last: date
) -> WindDataset:
    info = DatasetInfo(
        generated_at=utc(2026, 2, 2),
        source="synthetic",
        actual_days=(first, last),
        forecast_published=(delivery_day_bounds(first)[0], delivery_day_bounds(last)[1]),
        quality=empty_quality(),
    )
    return WindDataset(actuals, forecasts, info)


def synthetic_dataset(
    first_day: date = date(2025, 12, 15),
    last_day: date = date(2026, 1, 4),
    *,
    ratio: Callable[[datetime], float] = lambda _: OVER_FORECAST,
) -> WindDataset:
    actuals: list[ActualPoint] = []
    for day in iter_days(first_day, last_day):
        day_start, _ = delivery_day_bounds(day)
        for i in range(settlement_periods_in(day)):
            start = day_start + SETTLEMENT_PERIOD * i
            actuals.append(
                ActualPoint(
                    start_time=start,
                    publish_time=start + SETTLEMENT_PERIOD,
                    settlement_date=day,
                    settlement_period=i + 1,
                    generation_mw=actual_mw(start),
                )
            )

    forecasts: list[ForecastPoint] = []
    for day in iter_days(first_day - timedelta(days=3), last_day):
        first_target = datetime.combine(day - timedelta(days=1), time(21), tzinfo=UTC)
        for publish in PUBLISH_TIMES:
            published = datetime.combine(day, publish, tzinfo=UTC)
            for h in range(RUN_LENGTH_HOURS):
                target = first_target + timedelta(hours=h)
                forecasts.append(
                    ForecastPoint(published, target, actual_mw(target) * ratio(target))
                )
    return make_dataset(actuals, forecasts, first=first_day, last=last_day)
