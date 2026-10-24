from __future__ import annotations

from datetime import date, datetime, time

import pytest

from app.domain.calibration import MIN_SAMPLES, fit_calibration
from app.services.coverage import Coverage
from app.services.day_ahead import DayAheadService
from tests.factories import synthetic_dataset

WINDOW = {"lookback_days": 14, "history_from": date(2026, 1, 1), "history_to": date(2026, 1, 14)}


def test_realisation_rate_and_residual_band() -> None:
    # Outturn is 80% of forecast, then +/-100 MW of spread alternating.
    pairs = [(1000.0, 800.0 + (100.0 if i % 2 else -100.0)) for i in range(100)]
    cal = fit_calibration(pairs, **WINDOW)  # type: ignore[arg-type]
    assert cal is not None
    assert cal.realisation_rate == pytest.approx(0.8)
    assert cal.residual_p10 == pytest.approx(-100.0)
    assert cal.residual_p90 == pytest.approx(100.0)
    assert cal.expected(2000.0) == pytest.approx(1600.0)
    assert cal.band(2000.0) == pytest.approx((1500.0, 1700.0))


def test_band_never_goes_negative() -> None:
    pairs = [(1000.0, 800.0 + (500.0 if i % 2 else -500.0)) for i in range(100)]
    cal = fit_calibration(pairs, **WINDOW)  # type: ignore[arg-type]
    assert cal is not None
    low, _ = cal.band(100.0)
    assert low == 0.0


def test_thin_history_is_not_trusted() -> None:
    pairs = [(1000.0, 800.0)] * (MIN_SAMPLES - 1)
    assert fit_calibration(pairs, **WINDOW) is None  # type: ignore[arg-type]


def test_calibration_never_sees_the_day_before_delivery() -> None:
    """At gate closure on D-1 only D-2 and earlier are fully metered.

    Make the forecast wildly wrong from D-1 onwards: if any of that leaked into
    the calibration for D, the realisation rate would move away from 0.8.
    """
    delivery = date(2026, 1, 3)

    def ratio(target: datetime) -> float:
        return 3.0 if target.date() >= date(2026, 1, 2) else 1.25

    service = DayAheadService(
        synthetic_dataset(ratio=ratio), Coverage(date(2026, 1, 1), date(2026, 1, 3))
    )
    cal = service.calibration(delivery, time(9, 50), 7)
    assert cal is not None
    assert cal.history_to == date(2026, 1, 1)
    assert cal.history_from == date(2025, 12, 26)
    assert cal.realisation_rate == pytest.approx(0.8)
