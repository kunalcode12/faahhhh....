"""GB settlement calendar: delivery days, settlement periods and gate closures.

GB power is traded and settled in UK local time (Europe/London). A delivery
day runs from 00:00 to 24:00 local time and is split into 30-minute settlement
periods: 48 on a normal day, 46 on the spring clock change and 50 in autumn.

All timestamps in this codebase are UTC. This module is the only place where
UK local time is interpreted, which keeps clock-change bugs in one spot.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")
SETTLEMENT_PERIOD = timedelta(minutes=30)
ONE_DAY = timedelta(days=1)


def ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        raise ValueError("naive datetime: every timestamp must carry a timezone")
    return ts.astimezone(UTC)


def to_uk(ts: datetime) -> datetime:
    return ensure_utc(ts).astimezone(UK_TZ)


def delivery_day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC `[start, end)` of a UK delivery day."""
    start = datetime.combine(day, time.min, tzinfo=UK_TZ).astimezone(UTC)
    end = datetime.combine(day + ONE_DAY, time.min, tzinfo=UK_TZ).astimezone(UTC)
    return start, end


def delivery_day_of(ts: datetime) -> date:
    return to_uk(ts).date()


def settlement_period_of(ts: datetime) -> int:
    """1-based settlement period that `ts` falls in."""
    day_start, _ = delivery_day_bounds(delivery_day_of(ts))
    return (ensure_utc(ts) - day_start) // SETTLEMENT_PERIOD + 1


def settlement_periods_in(day: date) -> int:
    start, end = delivery_day_bounds(day)
    return (end - start) // SETTLEMENT_PERIOD


def gate_closure_utc(delivery_day: date, gate: time) -> datetime:
    """Auction gate closure for `delivery_day`: `gate` in UK local time on the day before."""
    return datetime.combine(delivery_day - ONE_DAY, gate, tzinfo=UK_TZ).astimezone(UTC)


def iter_days(first: date, last: date) -> Iterator[date]:
    """Inclusive range of dates."""
    day = first
    while day <= last:
        yield day
        day += ONE_DAY
