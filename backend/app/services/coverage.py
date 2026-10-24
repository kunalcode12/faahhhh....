"""Which delivery days this deployment answers questions about."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.core.config import Settings
from app.core.errors import InvalidRequestError, OutOfCoverageError
from app.domain.settlement import ONE_DAY


@dataclass(frozen=True, slots=True)
class Coverage:
    decision_from: date
    decision_to: date

    @classmethod
    def from_settings(cls, settings: Settings) -> Coverage:
        return cls(settings.decision_date_from, settings.decision_date_to)

    @property
    def delivery_from(self) -> date:
        return self.decision_from + ONE_DAY

    @property
    def delivery_to(self) -> date:
        return self.decision_to + ONE_DAY

    def _bounds_extra(self) -> dict[str, str]:
        return {
            "delivery_date_from": self.delivery_from.isoformat(),
            "delivery_date_to": self.delivery_to.isoformat(),
        }

    def require_delivery_day(self, day: date) -> None:
        if not self.delivery_from <= day <= self.delivery_to:
            raise OutOfCoverageError(
                f"{day.isoformat()} is outside the delivery days covered "
                f"({self.delivery_from.isoformat()} to {self.delivery_to.isoformat()}).",
                extra=self._bounds_extra(),
            )

    def require_range(self, start: date, end: date) -> None:
        if start > end:
            raise InvalidRequestError("start must be on or before end.")
        if start < self.delivery_from or end > self.delivery_to:
            raise OutOfCoverageError(
                f"Requested {start.isoformat()} to {end.isoformat()}, but data covers delivery "
                f"days {self.delivery_from.isoformat()} to {self.delivery_to.isoformat()}.",
                extra=self._bounds_extra(),
            )
