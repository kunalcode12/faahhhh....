"""Purpose 2: how far can the desk trust the forecast, in numbers?"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, time
from functools import lru_cache

from app.domain.calibration import Calibration
from app.domain.dataset import WindDataset
from app.domain.matching import MatchedForecast, match_forecasts
from app.domain.metrics import error_stats, error_stats_of, histogram
from app.domain.policies import FixedHorizonPolicy
from app.domain.settlement import delivery_day_bounds, delivery_day_of, iter_days, to_uk
from app.schemas.accuracy import (
    AccuracySeriesOut,
    AccuracySummaryOut,
    DailyOut,
    HistogramBinOut,
    HorizonBucketOut,
    HorizonCurveOut,
    HourOfDayOut,
    LevelBucketOut,
    Mode,
    SeriesActualOut,
    SeriesForecastOut,
    WindowOut,
)
from app.schemas.common import ErrorStatsOut, mw, share
from app.services.coverage import Coverage
from app.services.day_ahead import DayAheadService

LEVEL_BUCKET_MW = 2_000
HISTOGRAM_BIN_MW = 500
MAX_HORIZON_HOURS = 48


@dataclass(frozen=True, slots=True)
class AccuracyQuery:
    start: date
    end: date
    mode: Mode
    gate: time
    horizon_hours: int
    lookback_days: int

    def window(self) -> WindowOut:
        gate_mode = self.mode == "gate"
        return WindowOut(
            start=self.start,
            end=self.end,
            mode=self.mode,
            gate=f"{self.gate:%H:%M}" if gate_mode else None,
            horizon_hours=None if gate_mode else self.horizon_hours,
            lookback_days=self.lookback_days if gate_mode else None,
        )


@dataclass(frozen=True, slots=True)
class _Scored:
    match: MatchedForecast
    actual_mw: float
    calibrated_mw: float | None
    in_band: bool | None

    @property
    def error(self) -> float:
        return self.match.forecast_mw - self.actual_mw


class AccuracyService:
    def __init__(
        self, dataset: WindDataset, coverage: Coverage, day_ahead: DayAheadService
    ) -> None:
        self._dataset = dataset
        self._coverage = coverage
        self._day_ahead = day_ahead
        self.summary = lru_cache(maxsize=64)(self._summary)
        # A month of series is ~1.7 MB as objects but ~0.2 MB as JSON, and cheap to
        # rebuild from the cached matched days, so only the HTTP render cache keeps it.
        self.series = self._series
        self.horizon_curve = lru_cache(maxsize=16)(self._horizon_curve)

    # --- shared ----------------------------------------------------------------------

    def _bounds(self, start: date, end: date) -> tuple[date, date]:
        self._coverage.require_range(start, end)
        return start, end

    def _matched(self, q: AccuracyQuery) -> list[MatchedForecast]:
        if q.mode == "gate":
            # Re-uses the day-ahead service's per-day cache.
            return [
                m
                for day in iter_days(q.start, q.end)
                for m in self._day_ahead.matched_day(day, q.gate)
            ]
        start, _ = delivery_day_bounds(q.start)
        _, end = delivery_day_bounds(q.end)
        targets = self._dataset.forecast_targets_between(start, end)
        return match_forecasts(self._dataset, targets, FixedHorizonPolicy(q.horizon_hours))

    def _scored(self, q: AccuracyQuery) -> list[_Scored]:
        calibrations: dict[date, Calibration | None] = {}
        if q.mode == "gate":
            calibrations = {
                day: self._day_ahead.calibration(day, q.gate, q.lookback_days)
                for day in iter_days(q.start, q.end)
            }
        scored: list[_Scored] = []
        for m in self._matched(q):
            if m.actual_mw is None:
                continue
            cal = calibrations.get(delivery_day_of(m.target))
            if cal is None:
                scored.append(_Scored(m, m.actual_mw, None, None))
                continue
            p10, p90 = cal.band(m.forecast_mw)
            scored.append(
                _Scored(m, m.actual_mw, cal.expected(m.forecast_mw), p10 <= m.actual_mw <= p90)
            )
        return scored

    # --- endpoints -------------------------------------------------------------------

    def _summary(self, q: AccuracyQuery) -> AccuracySummaryOut:
        self._bounds(q.start, q.end)
        scored = self._scored(q)

        raw_pairs = [(s.match.forecast_mw, s.actual_mw) for s in scored]
        calibrated_pairs = [
            (s.calibrated_mw, s.actual_mw) for s in scored if s.calibrated_mw is not None
        ]
        band_flags = [s.in_band for s in scored if s.in_band is not None]

        by_hour: dict[int, list[tuple[float, float]]] = defaultdict(list)
        by_level: dict[int, list[tuple[float, float]]] = defaultdict(list)
        by_day: dict[date, list[_Scored]] = defaultdict(list)
        for s in scored:
            pair = (s.match.forecast_mw, s.actual_mw)
            by_hour[to_uk(s.match.target).hour].append(pair)
            by_level[math.floor(s.match.forecast_mw / LEVEL_BUCKET_MW)].append(pair)
            by_day[delivery_day_of(s.match.target)].append(s)

        hour_rows: list[HourOfDayOut] = []
        for hour, pairs in sorted(by_hour.items()):
            stats = error_stats_of(pairs)
            hour_rows.append(
                HourOfDayOut(
                    hour=hour,
                    count=stats.count,
                    mae_mw=mw(stats.mae),
                    bias_mw=mw(stats.bias),
                    p90_abs_mw=mw(stats.p90_abs),
                )
            )

        level_rows: list[LevelBucketOut] = []
        for bucket, pairs in sorted(by_level.items()):
            stats = error_stats_of(pairs)
            total_forecast = math.fsum(f for f, _ in pairs)
            level_rows.append(
                LevelBucketOut(
                    lower_mw=bucket * LEVEL_BUCKET_MW,
                    upper_mw=(bucket + 1) * LEVEL_BUCKET_MW,
                    count=stats.count,
                    mae_mw=mw(stats.mae),
                    bias_mw=mw(stats.bias),
                    realisation_rate=(
                        share(math.fsum(a for _, a in pairs) / total_forecast)
                        if total_forecast > 0
                        else 0.0
                    ),
                )
            )

        daily_rows: list[DailyOut] = []
        for day, items in sorted(by_day.items()):
            stats = error_stats_of([(s.match.forecast_mw, s.actual_mw) for s in items])
            calibrated = [
                abs(s.calibrated_mw - s.actual_mw) for s in items if s.calibrated_mw is not None
            ]
            daily_rows.append(
                DailyOut(
                    delivery_date=day,
                    mae_mw=mw(stats.mae),
                    bias_mw=mw(stats.bias),
                    calibrated_mae_mw=mw(math.fsum(calibrated) / len(calibrated))
                    if calibrated
                    else None,
                    forecast_energy_mwh=round(math.fsum(s.match.forecast_mw for s in items)),
                    actual_energy_mwh=round(math.fsum(s.actual_mw for s in items)),
                )
            )

        horizons = [s.match.forecast.horizon_hours for s in scored]
        return AccuracySummaryOut(
            window=q.window(),
            raw=ErrorStatsOut.maybe(error_stats(raw_pairs)),
            calibrated=ErrorStatsOut.maybe(error_stats(calibrated_pairs)),
            band_coverage=share(sum(band_flags) / len(band_flags)) if band_flags else None,
            lead_time_hours=(round(min(horizons), 2), round(max(horizons), 2))
            if horizons
            else None,
            by_hour=hour_rows,
            by_level=level_rows,
            distribution=[
                HistogramBinOut(lower_mw=b.lower, upper_mw=b.upper, count=b.count)
                for b in histogram((s.error for s in scored), HISTOGRAM_BIN_MW)
            ],
            daily=daily_rows,
        )

    def _series(self, q: AccuracyQuery) -> AccuracySeriesOut:
        self._bounds(q.start, q.end)
        start, _ = delivery_day_bounds(q.start)
        _, end = delivery_day_bounds(q.end)
        return AccuracySeriesOut(
            window=q.window(),
            forecasts=[
                SeriesForecastOut(
                    start_time=m.target,
                    forecast_mw=mw(m.forecast_mw),
                    published_at=m.forecast.publish_time,
                    horizon_hours=round(m.forecast.horizon_hours, 2),
                    actual_mw=mw(m.actual_mw) if m.actual_mw is not None else None,
                )
                for m in self._matched(q)
            ],
            actuals=[
                SeriesActualOut(start_time=a.start_time, actual_mw=mw(a.generation_mw))
                for a in self._dataset.actuals_between(start, end)
            ],
        )

    def _horizon_curve(self, start: date, end: date) -> HorizonCurveOut:
        """Error by lead time, using every value of every run (not just the latest)."""
        self._bounds(start, end)
        window_start, _ = delivery_day_bounds(start)
        _, window_end = delivery_day_bounds(end)

        buckets: dict[int, list[tuple[float, float]]] = defaultdict(list)
        for forecast in self._dataset.forecasts_for_targets_between(window_start, window_end):
            lead = forecast.horizon_hours
            if not 0 <= lead < MAX_HORIZON_HOURS + 1:
                continue
            actual = self._dataset.actual_at(forecast.start_time)
            if actual is not None:
                buckets[int(lead)].append((forecast.generation_mw, actual.generation_mw))

        rows: list[HorizonBucketOut] = []
        for lead_hours, pairs in sorted(buckets.items()):
            stats = error_stats_of(pairs)
            rows.append(
                HorizonBucketOut(
                    horizon_hours=lead_hours,
                    count=stats.count,
                    mae_mw=mw(stats.mae),
                    rmse_mw=mw(stats.rmse),
                    bias_mw=mw(stats.bias),
                    p90_abs_mw=mw(stats.p90_abs),
                )
            )
        return HorizonCurveOut(start=start, end=end, buckets=rows)
