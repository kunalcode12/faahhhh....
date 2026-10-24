"""In-memory, indexed, read-only store of wind actuals and forecast vintages.

The data behind this product is small (tens of thousands of rows) and does not
change once ingested, so the fastest "database" is a few sorted Python indexes
built once at startup:

- actuals keyed by start time                     -> O(1) lookup
- forecast values per target hour, sorted by publish time -> O(log n) "as-of" lookup
- vintages keyed by publish time                  -> forecast-evolution views

A dataset never mutates after construction. Refreshing data means building a
new dataset and swapping the reference, which is atomic and needs no locks.
"""

from __future__ import annotations

import bisect
import hashlib
from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date, datetime

from app.domain.models import ActualPoint, ForecastPoint


@dataclass(frozen=True, slots=True)
class DataQuality:
    actual_periods_expected: int
    actual_periods_present: int
    missing_actual_periods: tuple[datetime, ...]  # capped sample, for display
    forecast_vintages: int
    forecast_points: int
    max_vintage_gap_hours: float
    duplicate_rows_dropped: int
    invalid_rows_dropped: int


@dataclass(frozen=True, slots=True)
class DatasetInfo:
    generated_at: datetime
    source: str
    actual_days: tuple[date, date]
    forecast_published: tuple[datetime, datetime]
    quality: DataQuality


class WindDataset:
    def __init__(
        self,
        actuals: Iterable[ActualPoint],
        forecasts: Iterable[ForecastPoint],
        info: DatasetInfo,
    ) -> None:
        self.info = info

        ordered_actuals = sorted(actuals, key=lambda a: a.start_time)
        self._actuals = {a.start_time: a for a in ordered_actuals}
        self._actual_times = list(self._actuals)

        ordered_forecasts = sorted(forecasts, key=lambda f: (f.publish_time, f.start_time))
        by_target: dict[datetime, list[ForecastPoint]] = defaultdict(list)
        by_vintage: dict[datetime, list[ForecastPoint]] = defaultdict(list)
        for point in ordered_forecasts:
            by_target[point.start_time].append(point)  # stays sorted by publish time
            by_vintage[point.publish_time].append(point)  # stays sorted by start time

        # Parallel lists so `bisect` can search publish times directly.
        self._by_target: dict[datetime, tuple[list[datetime], list[ForecastPoint]]] = {
            target: ([p.publish_time for p in points], points)
            for target, points in by_target.items()
        }
        self._targets = sorted(self._by_target)
        self._vintages = dict(by_vintage)
        self._vintage_times = sorted(self._vintages)

        self.forecast_count = len(ordered_forecasts)
        self.version = _fingerprint(ordered_actuals, ordered_forecasts)

    # --- actuals -----------------------------------------------------------------

    @property
    def actual_count(self) -> int:
        return len(self._actual_times)

    def actual_at(self, start_time: datetime) -> ActualPoint | None:
        return self._actuals.get(start_time)

    def actuals_between(self, start: datetime, end: datetime) -> list[ActualPoint]:
        """Actuals with `start <= start_time < end`."""
        lo = bisect.bisect_left(self._actual_times, start)
        hi = bisect.bisect_left(self._actual_times, end)
        return [self._actuals[t] for t in self._actual_times[lo:hi]]

    # --- forecasts ---------------------------------------------------------------

    def forecast_as_of(
        self, target: datetime, cutoff: datetime, *, inclusive: bool
    ) -> ForecastPoint | None:
        """Latest forecast for `target` published before `cutoff`.

        `inclusive=True` also accepts a forecast published exactly at `cutoff`.
        This single lookup is what keeps every view free of look-ahead bias.
        """
        entry = self._by_target.get(target)
        if entry is None:
            return None
        publish_times, points = entry
        search = bisect.bisect_right if inclusive else bisect.bisect_left
        idx = search(publish_times, cutoff) - 1
        return points[idx] if idx >= 0 else None

    def forecast_targets_between(self, start: datetime, end: datetime) -> list[datetime]:
        """Target hours with at least one forecast, `start <= t < end`."""
        lo = bisect.bisect_left(self._targets, start)
        hi = bisect.bisect_left(self._targets, end)
        return self._targets[lo:hi]

    def forecasts_for_targets_between(
        self, start: datetime, end: datetime
    ) -> Iterator[ForecastPoint]:
        """Every forecast value from every vintage for targets in `[start, end)`."""
        for target in self.forecast_targets_between(start, end):
            yield from self._by_target[target][1]

    @property
    def vintage_count(self) -> int:
        return len(self._vintage_times)

    def vintage_times_between(self, start: datetime, end: datetime) -> list[datetime]:
        lo = bisect.bisect_left(self._vintage_times, start)
        hi = bisect.bisect_left(self._vintage_times, end)
        return self._vintage_times[lo:hi]

    def vintage(self, publish_time: datetime) -> Sequence[ForecastPoint]:
        return self._vintages.get(publish_time, ())


def _fingerprint(actuals: Sequence[ActualPoint], forecasts: Sequence[ForecastPoint]) -> str:
    """Content hash. Changes whenever any value changes; used in ETags and /meta."""
    parts = [f"a{a.start_time.timestamp():.0f}:{a.generation_mw:g}" for a in actuals]
    parts += [
        f"f{f.publish_time.timestamp():.0f}:{f.start_time.timestamp():.0f}:{f.generation_mw:g}"
        for f in forecasts
    ]
    return hashlib.sha256(";".join(parts).encode()).hexdigest()[:16]
