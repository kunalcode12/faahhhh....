"""Which forecast "counts" for a given target hour.

This is the core business rule of the product. Two policies share one tiny
interface, so everything downstream (matching, metrics, charts) is identical
whichever question the user is asking:

- `GateClosurePolicy` - "what did we know when we had to bid?" For delivery
  day D, use the latest run published strictly before the auction gate on D-1.
- `FixedHorizonPolicy` - "how good is the forecast H hours out?" For each
  target, use the latest run published at least H hours before it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Protocol

from app.domain.settlement import delivery_day_of, gate_closure_utc


class ForecastPolicy(Protocol):
    @property
    def inclusive(self) -> bool:
        """Whether a forecast published exactly at the cutoff is usable."""
        ...

    def cutoff(self, target: datetime) -> datetime:
        """Latest moment a forecast for `target` may have been published."""
        ...


@dataclass(frozen=True, slots=True)
class GateClosurePolicy:
    gate: time

    @property
    def inclusive(self) -> bool:
        # A forecast landing at the exact moment the auction closes is too late to act on.
        return False

    def cutoff(self, target: datetime) -> datetime:
        return gate_closure_utc(delivery_day_of(target), self.gate)


@dataclass(frozen=True, slots=True)
class FixedHorizonPolicy:
    hours: float

    @property
    def inclusive(self) -> bool:
        return True  # "published at least H hours before"

    def cutoff(self, target: datetime) -> datetime:
        return target - timedelta(hours=self.hours)
