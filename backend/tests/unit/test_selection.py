"""The as-of rule: which forecast was actually available at decision time."""

from __future__ import annotations

from datetime import date, time

import pytest

from app.domain.dataset import WindDataset
from app.domain.matching import match_forecasts
from app.domain.models import ActualPoint, ForecastPoint
from app.domain.policies import FixedHorizonPolicy, ForecastPolicy, GateClosurePolicy
from tests.factories import make_dataset, utc

TARGET = utc(2026, 1, 15, 12)
RUNS = {
    utc(2026, 1, 14, 7, 30): 100.0,
    utc(2026, 1, 14, 9, 30): 200.0,
    utc(2026, 1, 14, 11, 30): 300.0,
    utc(2026, 1, 15, 11, 30): 400.0,
}


def build(runs: dict = RUNS) -> WindDataset:  # type: ignore[type-arg]
    forecasts = [ForecastPoint(published, TARGET, mw) for published, mw in runs.items()]
    actuals = [ActualPoint(TARGET, utc(2026, 1, 15, 12, 30), date(2026, 1, 15), 25, 150.0)]
    return make_dataset(actuals, forecasts, first=date(2026, 1, 15), last=date(2026, 1, 15))


@pytest.fixture
def dataset() -> WindDataset:
    return build()


def value(dataset: WindDataset, policy: ForecastPolicy) -> float | None:
    point = dataset.forecast_as_of(TARGET, policy.cutoff(TARGET), inclusive=policy.inclusive)
    return None if point is None else point.generation_mw


def test_gate_policy_takes_latest_run_before_gate(dataset: WindDataset) -> None:
    assert value(dataset, GateClosurePolicy(time(9, 50))) == 200.0
    assert value(dataset, GateClosurePolicy(time(15, 30))) == 300.0


def test_run_published_exactly_at_gate_is_too_late(dataset: WindDataset) -> None:
    assert value(dataset, GateClosurePolicy(time(9, 30))) == 100.0


def test_horizon_policy_includes_runs_exactly_h_hours_before(dataset: WindDataset) -> None:
    assert value(dataset, FixedHorizonPolicy(24)) == 300.0  # cutoff 14 Jan 12:00
    assert value(dataset, FixedHorizonPolicy(0.5)) == 400.0  # cutoff 15 Jan 11:30, inclusive
    assert value(dataset, FixedHorizonPolicy(0)) == 400.0


def test_no_run_old_enough_means_no_forecast(dataset: WindDataset) -> None:
    assert value(dataset, FixedHorizonPolicy(48)) is None


def test_matching_scores_forecast_minus_actual(dataset: WindDataset) -> None:
    [match] = match_forecasts(dataset, [TARGET], GateClosurePolicy(time(9, 50)))
    assert match.forecast_mw == 200.0
    assert match.actual_mw == 150.0
    assert match.error_mw == 50.0  # positive: forecast promised more than came
    assert match.forecast.horizon_hours == pytest.approx(26.5)


def test_targets_without_any_eligible_run_are_skipped(dataset: WindDataset) -> None:
    assert match_forecasts(dataset, [TARGET], FixedHorizonPolicy(48)) == []


def test_version_is_a_content_hash(dataset: WindDataset) -> None:
    assert build().version == dataset.version
    changed = build({**RUNS, utc(2026, 1, 14, 9, 30): 201.0})
    assert changed.version != dataset.version
