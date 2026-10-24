from __future__ import annotations

import math

import pytest

from app.domain.metrics import error_stats, error_stats_of, histogram, quantile


@pytest.mark.parametrize(
    ("q", "expected"),
    [(0.0, 1.0), (0.5, 2.5), (0.9, 3.7), (1.0, 4.0)],
)
def test_quantile_interpolates_linearly(q: float, expected: float) -> None:
    assert quantile([1.0, 2.0, 3.0, 4.0], q) == pytest.approx(expected)


def test_quantile_rejects_bad_input() -> None:
    with pytest.raises(ValueError, match="empty"):
        quantile([], 0.5)
    with pytest.raises(ValueError, match="within"):
        quantile([1.0], 1.5)


def test_error_stats_known_answers() -> None:
    # errors: +10, -10, +30
    stats = error_stats([(110.0, 100.0), (90.0, 100.0), (130.0, 100.0)])
    assert stats is not None
    assert stats.count == 3
    assert stats.mae == pytest.approx(50 / 3)
    assert stats.rmse == pytest.approx(math.sqrt(1100 / 3))
    assert stats.bias == pytest.approx(10.0)
    assert stats.wape == pytest.approx(50 / 300)
    assert stats.p50_abs == pytest.approx(10.0)
    assert stats.max_abs == pytest.approx(30.0)
    assert stats.over_forecast_share == pytest.approx(2 / 3)
    assert stats.mean_forecast == pytest.approx(110.0)
    assert stats.mean_actual == pytest.approx(100.0)


def test_error_stats_edge_cases() -> None:
    assert error_stats([]) is None
    single = error_stats([(5.0, 4.0)])
    assert single is not None
    assert single.correlation is None  # undefined for one point
    zero_output = error_stats([(5.0, 0.0), (3.0, 0.0)])
    assert zero_output is not None
    assert zero_output.wape is None  # no delivered energy to divide by
    with pytest.raises(ValueError, match="empty"):
        error_stats_of([])


def test_histogram_bins_are_aligned_to_zero() -> None:
    bins = histogram([-600, -100, 100, 499, 500, 1600], width=500)
    assert [(b.lower, b.upper, b.count) for b in bins] == [
        (-1000, -500, 1),
        (-500, 0, 1),
        (0, 500, 2),
        (500, 1000, 1),
        (1000, 1500, 0),  # empty bins inside the range are kept
        (1500, 2000, 1),
    ]
    assert histogram([], width=500) == []
