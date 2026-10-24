"""Purpose 1: what does the desk know about tomorrow's wind at gate closure?"""

from __future__ import annotations

import math
from datetime import date, time, timedelta
from functools import lru_cache

from app.core.errors import OutOfCoverageError
from app.domain.calibration import Calibration, fit_calibration
from app.domain.dataset import WindDataset
from app.domain.matching import MatchedForecast, match_forecasts, scored_pairs
from app.domain.metrics import error_stats
from app.domain.policies import GateClosurePolicy
from app.domain.settlement import (
    delivery_day_bounds,
    gate_closure_utc,
    iter_days,
    settlement_period_of,
    settlement_periods_in,
)
from app.schemas.common import ErrorStatsOut, mw, share
from app.schemas.day_ahead import (
    CalibrationOut,
    DayAheadOut,
    DaySummaryOut,
    GateOut,
    HalfHourOut,
    HourOut,
    PeakOut,
    PointOut,
    VintageEvolutionOut,
    VintageOut,
    VintageRefOut,
)
from app.services.coverage import Coverage

HALF_HOUR_H = 0.5
EVOLUTION_WINDOW = timedelta(days=2)


def _opt_mw(value: float | None) -> float | None:
    return mw(value) if value is not None else None


def _gate_out(day: date, gate: time) -> GateOut:
    return GateOut(local_time=f"{gate:%H:%M}", closes_at=gate_closure_utc(day, gate))


class DayAheadService:
    def __init__(self, dataset: WindDataset, coverage: Coverage) -> None:
        self._dataset = dataset
        self._coverage = coverage
        # Results are pure functions of their arguments for the lifetime of this
        # dataset, so per-instance LRU caches turn repeats into a dict lookup.
        # The small building blocks are cached generously: the accuracy page
        # calibrates 31 days that share the same matched days over and over.
        # Whole responses are cached sparingly - the HTTP layer already keeps
        # their rendered JSON, which is ~9x more compact than the model objects.
        self.matched_day = lru_cache(maxsize=4096)(self._matched_day)
        self.calibration = lru_cache(maxsize=4096)(self._calibration)
        self.view = lru_cache(maxsize=128)(self._view)
        self.evolution = lru_cache(maxsize=128)(self._evolution)

    # --- building blocks (also used by the accuracy service) ------------------------

    def _matched_day(self, day: date, gate: time) -> tuple[MatchedForecast, ...]:
        start, end = delivery_day_bounds(day)
        targets = self._dataset.forecast_targets_between(start, end)
        return tuple(match_forecasts(self._dataset, targets, GateClosurePolicy(gate)))

    def _calibration(self, day: date, gate: time, lookback_days: int) -> Calibration | None:
        # At gate closure on D-1 only days up to D-2 are fully metered, so the
        # history window ends there. Nothing from D-1 or later can leak in.
        history_to = day - timedelta(days=2)
        history_from = day - timedelta(days=lookback_days + 1)
        pairs: list[tuple[float, float]] = []
        for history_day in iter_days(history_from, history_to):
            pairs.extend(scored_pairs(self.matched_day(history_day, gate)))
        return fit_calibration(
            pairs, lookback_days=lookback_days, history_from=history_from, history_to=history_to
        )

    # --- endpoints -------------------------------------------------------------------

    def _view(self, day: date, gate: time, lookback_days: int) -> DayAheadOut:
        self._coverage.require_delivery_day(day)
        matched = self.matched_day(day, gate)
        if not matched:
            raise OutOfCoverageError(
                f"No forecast published before the {gate:%H:%M} gate covers {day.isoformat()}."
            )
        calibration = self.calibration(day, gate, lookback_days)
        closes_at = gate_closure_utc(day, gate)
        used = max(m.forecast.publish_time for m in matched)

        hours: list[HourOut] = []
        calibrated_pairs: list[tuple[float, float]] = []
        inside_band = 0
        for m in matched:
            calibrated = p10 = p90 = None
            if calibration is not None:
                calibrated = calibration.expected(m.forecast_mw)
                p10, p90 = calibration.band(m.forecast_mw)
                if m.actual_mw is not None:
                    calibrated_pairs.append((calibrated, m.actual_mw))
                    inside_band += p10 <= m.actual_mw <= p90
            hours.append(
                HourOut(
                    start_time=m.target,
                    settlement_period=settlement_period_of(m.target),
                    forecast_mw=mw(m.forecast_mw),
                    calibrated_mw=_opt_mw(calibrated),
                    p10_mw=_opt_mw(p10),
                    p90_mw=_opt_mw(p90),
                    actual_mw=_opt_mw(m.actual_mw),
                    error_mw=_opt_mw(m.error_mw),
                    calibrated_error_mw=(
                        mw(calibrated - m.actual_mw)
                        if calibrated is not None and m.actual_mw is not None
                        else None
                    ),
                    published_at=m.forecast.publish_time,
                    horizon_hours=round(m.forecast.horizon_hours, 2),
                )
            )

        day_start, day_end = delivery_day_bounds(day)
        half_hours = self._dataset.actuals_between(day_start, day_end)
        expected_periods = settlement_periods_in(day)
        actual_complete = len(half_hours) == expected_periods

        peak = max(matched, key=lambda m: m.forecast_mw)
        trough = min(matched, key=lambda m: m.forecast_mw)
        summary = DaySummaryOut(
            forecast_energy_mwh=round(math.fsum(m.forecast_mw for m in matched)),
            calibrated_energy_mwh=(
                round(math.fsum(calibration.expected(m.forecast_mw) for m in matched))
                if calibration is not None
                else None
            ),
            actual_energy_mwh=(
                round(math.fsum(a.generation_mw * HALF_HOUR_H for a in half_hours))
                if actual_complete
                else None
            ),
            forecast_peak=PeakOut(mw=mw(peak.forecast_mw), start_time=peak.target),
            forecast_trough=PeakOut(mw=mw(trough.forecast_mw), start_time=trough.target),
            forecast_mean_mw=mw(math.fsum(m.forecast_mw for m in matched) / len(matched)),
            raw_error=ErrorStatsOut.maybe(error_stats(scored_pairs(matched))),
            calibrated_error=ErrorStatsOut.maybe(error_stats(calibrated_pairs)),
            band_coverage=(
                share(inside_band / len(calibrated_pairs)) if calibrated_pairs else None
            ),
        )

        notes = [
            "WINDFOR forecasts are hourly and outturn is half-hourly, "
            "so errors are scored at the top of each hour."
        ]
        if calibration is None:
            notes.append(
                "Not enough settled history to calibrate this day; showing the published "
                "forecast only."
            )
        if not actual_complete:
            notes.append(
                f"Outturn is incomplete: {len(half_hours)} of {expected_periods} "
                "settlement periods metered."
            )
        if len({m.forecast.publish_time for m in matched}) > 1:
            notes.append(
                "The latest run before the gate did not cover every hour; an earlier run "
                "fills the gaps."
            )

        return DayAheadOut(
            delivery_date=day,
            settlement_periods=expected_periods,
            gate=_gate_out(day, gate),
            vintage=VintageRefOut(
                published_at=used,
                minutes_before_gate=int((closes_at - used).total_seconds() // 60),
            ),
            calibration=(
                CalibrationOut(
                    lookback_days=calibration.lookback_days,
                    history_from=calibration.history_from,
                    history_to=calibration.history_to,
                    sample_size=calibration.sample_size,
                    realisation_rate=share(calibration.realisation_rate),
                    residual_p10_mw=mw(calibration.residual_p10),
                    residual_p90_mw=mw(calibration.residual_p90),
                )
                if calibration is not None
                else None
            ),
            summary=summary,
            hours=hours,
            actuals=[
                HalfHourOut(
                    start_time=a.start_time,
                    settlement_period=a.settlement_period,
                    actual_mw=mw(a.generation_mw),
                )
                for a in half_hours
            ],
            notes=notes,
        )

    def _evolution(self, day: date, gate: time) -> VintageEvolutionOut:
        """Every run published in the two days before delivery, and how each saw the day."""
        self._coverage.require_delivery_day(day)
        day_start, day_end = delivery_day_bounds(day)
        closes_at = gate_closure_utc(day, gate)

        publish_times = self._dataset.vintage_times_between(day_start - EVOLUTION_WINDOW, day_start)
        before_gate = [p for p in publish_times if p < closes_at]
        used = before_gate[-1] if before_gate else None

        vintages: list[VintageOut] = []
        for published in publish_times:
            points = [
                p for p in self._dataset.vintage(published) if day_start <= p.start_time < day_end
            ]
            if not points:
                continue
            if published == used:
                status = "used"
            elif published < closes_at:
                status = "before_gate"
            else:
                status = "after_gate"
            vintages.append(
                VintageOut(
                    published_at=published,
                    status=status,
                    hours_ahead_of_delivery=round(
                        (day_start - published).total_seconds() / 3600, 2
                    ),
                    energy_mwh=round(math.fsum(p.generation_mw for p in points)),
                    points=[
                        PointOut(start_time=p.start_time, mw=mw(p.generation_mw)) for p in points
                    ],
                )
            )

        actual_hourly = [
            PointOut(start_time=t, mw=mw(actual.generation_mw))
            for t in self._dataset.forecast_targets_between(day_start, day_end)
            if (actual := self._dataset.actual_at(t)) is not None
        ]
        half_hours = self._dataset.actuals_between(day_start, day_end)
        actual_energy = (
            round(math.fsum(a.generation_mw * HALF_HOUR_H for a in half_hours))
            if len(half_hours) == settlement_periods_in(day)
            else None
        )
        return VintageEvolutionOut(
            delivery_date=day,
            gate=_gate_out(day, gate),
            actual_energy_mwh=actual_energy,
            actual_hourly=actual_hourly,
            vintages=vintages,
        )
