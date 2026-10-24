"""FastAPI dependencies: shared objects and reusable, validated query parameters."""

from __future__ import annotations

from datetime import time
from typing import Annotated, Any

from fastapi import Depends, Query, Request

from app.core.config import Settings
from app.domain.calibration import DEFAULT_LOOKBACK_DAYS, LOOKBACK_OPTIONS
from app.domain.gates import DEFAULT_GATE
from app.schemas.common import ProblemOut
from app.services.provider import DatasetProvider, ServiceBundle


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _provider(request: Request) -> DatasetProvider:
    provider: DatasetProvider = request.app.state.provider
    return provider


def _bundle(provider: Annotated[DatasetProvider, Depends(_provider)]) -> ServiceBundle:
    return provider.bundle()  # 503 while the dataset is loading


def _gate(
    gate: Annotated[
        time,
        Query(
            description="Auction gate closure as HH:MM, UK local time on the day before delivery",
            examples=["09:50"],
        ),
    ] = DEFAULT_GATE,
) -> time:
    # Normalise so "09:50", "09:50:00" and "09:50Z" share one cache entry.
    return gate.replace(second=0, microsecond=0, tzinfo=None)


SettingsDep = Annotated[Settings, Depends(_settings)]
ProviderDep = Annotated[DatasetProvider, Depends(_provider)]
BundleDep = Annotated[ServiceBundle, Depends(_bundle)]
GateDep = Annotated[time, Depends(_gate)]
LookbackQuery = Annotated[
    int,
    Query(
        ge=min(LOOKBACK_OPTIONS),
        le=max(LOOKBACK_OPTIONS),
        description="Days of settled history used to calibrate (trailing, no look-ahead)",
    ),
]
DEFAULT_LOOKBACK = DEFAULT_LOOKBACK_DAYS


def _problem(description: str) -> dict[str, Any]:
    return {"model": ProblemOut, "description": description}


PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    404: _problem("Outside the data coverage"),
    422: _problem("Invalid parameters"),
    429: _problem("Rate limited"),
    503: _problem("Data still loading"),
}
