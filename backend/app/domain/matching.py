"""Pair each target hour with the forecast a policy selects and the actual outturn."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from app.domain.dataset import WindDataset
from app.domain.models import ForecastPoint
from app.domain.policies import ForecastPolicy


@dataclass(frozen=True, slots=True)
class MatchedForecast:
    target: datetime
    forecast: ForecastPoint
    actual_mw: float | None  # None until the period has been metered

    @property
    def forecast_mw(self) -> float:
        return self.forecast.generation_mw

    @property
    def error_mw(self) -> float | None:
        """forecast - actual. Positive means the forecast promised more wind than came."""
        return None if self.actual_mw is None else self.forecast_mw - self.actual_mw


def match_forecasts(
    dataset: WindDataset, targets: Iterable[datetime], policy: ForecastPolicy
) -> list[MatchedForecast]:
    """Targets with no eligible forecast are skipped rather than guessed."""
    matched: list[MatchedForecast] = []
    for target in targets:
        forecast = dataset.forecast_as_of(target, policy.cutoff(target), inclusive=policy.inclusive)
        if forecast is None:
            continue
        actual = dataset.actual_at(target)
        matched.append(MatchedForecast(target, forecast, actual.generation_mw if actual else None))
    return matched


def scored_pairs(matched: Iterable[MatchedForecast]) -> list[tuple[float, float]]:
    """(forecast, actual) pairs for the points whose outturn is known."""
    return [(m.forecast_mw, m.actual_mw) for m in matched if m.actual_mw is not None]
