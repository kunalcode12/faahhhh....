from __future__ import annotations

from datetime import date, datetime, time

import pytest

from app.domain.settlement import (
    delivery_day_bounds,
    delivery_day_of,
    ensure_utc,
    gate_closure_utc,
    iter_days,
    settlement_period_of,
    settlement_periods_in,
)
from tests.factories import utc


def test_winter_day_is_aligned_with_utc() -> None:
    assert delivery_day_bounds(date(2026, 1, 15)) == (utc(2026, 1, 15), utc(2026, 1, 16))


def test_summer_day_starts_at_2300_utc_the_evening_before() -> None:
    start, end = delivery_day_bounds(date(2026, 7, 1))
    assert start == utc(2026, 6, 30, 23)
    assert end == utc(2026, 7, 1, 23)


@pytest.mark.parametrize(
    ("day", "periods"),
    [
        (date(2026, 1, 15), 48),
        (date(2026, 3, 29), 46),  # clocks go forward: 23-hour day
        (date(2026, 10, 25), 50),  # clocks go back: 25-hour day
    ],
)
def test_settlement_periods_follow_clock_changes(day: date, periods: int) -> None:
    assert settlement_periods_in(day) == periods


@pytest.mark.parametrize(
    ("ts", "period"),
    [
        (utc(2026, 1, 15, 0, 0), 1),
        (utc(2026, 1, 15, 0, 30), 2),
        (utc(2026, 1, 15, 23, 30), 48),
        (utc(2026, 6, 30, 23, 0), 1),  # 00:00 BST
        (utc(2026, 10, 25, 23, 30), 50),  # last period of the long day
    ],
)
def test_settlement_period_of(ts: datetime, period: int) -> None:
    assert settlement_period_of(ts) == period


def test_delivery_day_uses_uk_local_date() -> None:
    assert delivery_day_of(utc(2026, 6, 30, 23, 30)) == date(2026, 7, 1)


def test_gate_closure_is_uk_local_time_on_the_day_before() -> None:
    assert gate_closure_utc(date(2026, 1, 15), time(9, 50)) == utc(2026, 1, 14, 9, 50)
    assert gate_closure_utc(date(2026, 7, 1), time(9, 50)) == utc(2026, 6, 30, 8, 50)
    # Delivery on 30 Mar: the gate is on 29 Mar, already in BST.
    assert gate_closure_utc(date(2026, 3, 30), time(9, 50)) == utc(2026, 3, 29, 8, 50)


def test_naive_datetimes_are_rejected() -> None:
    with pytest.raises(ValueError, match="naive"):
        ensure_utc(datetime(2026, 1, 1))  # noqa: DTZ001 - deliberately naive


def test_iter_days_is_inclusive() -> None:
    assert list(iter_days(date(2026, 1, 30), date(2026, 2, 1))) == [
        date(2026, 1, 30),
        date(2026, 1, 31),
        date(2026, 2, 1),
    ]
