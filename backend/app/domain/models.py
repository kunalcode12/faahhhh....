"""Core value objects. Immutable, slotted, and always in UTC."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta


@dataclass(frozen=True, slots=True)
class ActualPoint:
    """Metered wind outturn for one 30-minute settlement period (Elexon FUELHH, WIND)."""

    start_time: datetime
    publish_time: datetime
    settlement_date: date
    settlement_period: int
    generation_mw: float


@dataclass(frozen=True, slots=True)
class ForecastPoint:
    """One hourly value from one forecast run (Elexon WINDFOR).

    A *vintage* is every point sharing a `publish_time`. NESO publishes roughly
    eight vintages a day, each covering about three days ahead.
    """

    publish_time: datetime
    start_time: datetime
    generation_mw: float

    @property
    def horizon(self) -> timedelta:
        """Lead time: how far ahead of the target this value was published."""
        return self.start_time - self.publish_time

    @property
    def horizon_hours(self) -> float:
        return self.horizon.total_seconds() / 3600
