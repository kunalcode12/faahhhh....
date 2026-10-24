"""Turn raw upstream rows into clean domain points and a data-quality report.

Rules:
- Rows missing any required field are dropped and counted as invalid.
- Actuals: one value per settlement period; if Elexon re-publishes a period,
  the latest publication wins.
- Forecasts: one value per (vintage, target hour); repeats from overlapping
  fetch windows collapse to one.
- Everything outside the requested window is discarded.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from itertools import pairwise

from app.domain.dataset import DataQuality
from app.domain.models import ActualPoint, ForecastPoint
from app.domain.settlement import (
    SETTLEMENT_PERIOD,
    delivery_day_bounds,
    ensure_utc,
    iter_days,
    settlement_periods_in,
)
from app.ingestion.elexon import FuelHHRow, WindForRow

MISSING_SAMPLE_LIMIT = 48


@dataclass(frozen=True, slots=True)
class NormalizedData:
    actuals: list[ActualPoint]
    forecasts: list[ForecastPoint]
    quality: DataQuality


def _expected_period_starts(first_day: date, last_day: date) -> list[datetime]:
    starts: list[datetime] = []
    for day in iter_days(first_day, last_day):
        day_start, _ = delivery_day_bounds(day)
        starts.extend(day_start + SETTLEMENT_PERIOD * i for i in range(settlement_periods_in(day)))
    return starts


def normalize(
    fuel_rows: Iterable[FuelHHRow],
    forecast_rows: Iterable[WindForRow],
    *,
    actual_days: tuple[date, date],
    published: tuple[datetime, datetime],
) -> NormalizedData:
    invalid = 0
    duplicates = 0

    actuals: dict[datetime, ActualPoint] = {}
    for row in fuel_rows:
        if row.fuel_type != "WIND":
            continue
        if (
            row.start_time is None
            or row.publish_time is None
            or row.settlement_date is None
            or row.settlement_period is None
            or row.generation is None
        ):
            invalid += 1
            continue
        if not actual_days[0] <= row.settlement_date <= actual_days[1]:
            continue
        point = ActualPoint(
            start_time=ensure_utc(row.start_time),
            publish_time=ensure_utc(row.publish_time),
            settlement_date=row.settlement_date,
            settlement_period=row.settlement_period,
            generation_mw=float(row.generation),
        )
        existing = actuals.get(point.start_time)
        if existing is not None:
            duplicates += 1
            if existing.publish_time >= point.publish_time:
                continue
        actuals[point.start_time] = point

    forecasts: dict[tuple[datetime, datetime], ForecastPoint] = {}
    for f_row in forecast_rows:
        if f_row.publish_time is None or f_row.start_time is None or f_row.generation is None:
            invalid += 1
            continue
        publish_time = ensure_utc(f_row.publish_time)
        if not published[0] <= publish_time <= published[1]:
            continue
        key = (publish_time, ensure_utc(f_row.start_time))
        if key in forecasts:
            duplicates += 1
        forecasts[key] = ForecastPoint(
            publish_time=key[0], start_time=key[1], generation_mw=float(f_row.generation)
        )

    expected = _expected_period_starts(*actual_days)
    missing = [start for start in expected if start not in actuals]
    vintages = sorted({publish for publish, _ in forecasts})
    max_gap = max(
        ((later - earlier).total_seconds() / 3600 for earlier, later in pairwise(vintages)),
        default=0.0,
    )

    quality = DataQuality(
        actual_periods_expected=len(expected),
        actual_periods_present=len(expected) - len(missing),
        missing_actual_periods=tuple(missing[:MISSING_SAMPLE_LIMIT]),
        forecast_vintages=len(vintages),
        forecast_points=len(forecasts),
        max_vintage_gap_hours=round(max_gap, 2),
        duplicate_rows_dropped=duplicates,
        invalid_rows_dropped=invalid,
    )
    return NormalizedData(
        actuals=sorted(actuals.values(), key=lambda a: a.start_time),
        forecasts=sorted(forecasts.values(), key=lambda f: (f.publish_time, f.start_time)),
        quality=quality,
    )
