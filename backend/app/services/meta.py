"""Describes the deployment to the frontend: coverage, gate presets, defaults, data health."""

from __future__ import annotations

from app import __version__
from app.core.config import Settings
from app.domain.calibration import DEFAULT_LOOKBACK_DAYS, LOOKBACK_OPTIONS
from app.domain.gates import DEFAULT_GATE, GATE_PRESETS
from app.schemas.meta import (
    CoverageOut,
    DataQualityOut,
    DatasetOut,
    DefaultsOut,
    GatePresetOut,
    LimitsOut,
    MetaOut,
)
from app.services.accuracy import MAX_HORIZON_HOURS
from app.services.provider import ServiceBundle

DEFAULT_HORIZON_HOURS = 24


def build_meta(settings: Settings, bundle: ServiceBundle) -> MetaOut:
    dataset = bundle.dataset
    quality = dataset.info.quality
    return MetaOut(
        name=settings.app_name,
        version=__version__,
        coverage=CoverageOut(
            decision_date_from=bundle.coverage.decision_from,
            decision_date_to=bundle.coverage.decision_to,
            delivery_date_from=bundle.coverage.delivery_from,
            delivery_date_to=bundle.coverage.delivery_to,
        ),
        gates=[
            GatePresetOut(
                id=g.id,
                label=g.label,
                venue=g.venue,
                product=g.product,
                gate=f"{g.gate:%H:%M}",
                results=g.results,
                description=g.description,
            )
            for g in GATE_PRESETS
        ],
        defaults=DefaultsOut(
            gate=f"{DEFAULT_GATE:%H:%M}",
            lookback_days=DEFAULT_LOOKBACK_DAYS,
            horizon_hours=DEFAULT_HORIZON_HOURS,
        ),
        limits=LimitsOut(
            lookback_days_options=list(LOOKBACK_OPTIONS),
            lookback_days_min=min(LOOKBACK_OPTIONS),
            lookback_days_max=max(LOOKBACK_OPTIONS),
            horizon_hours_max=MAX_HORIZON_HOURS,
        ),
        dataset=DatasetOut(
            version=dataset.version,
            source=dataset.info.source,
            origin=bundle.origin,
            generated_at=dataset.info.generated_at,
            loaded_at=bundle.loaded_at,
            actual_days_from=dataset.info.actual_days[0],
            actual_days_to=dataset.info.actual_days[1],
            actual_points=dataset.actual_count,
            forecast_points=dataset.forecast_count,
            forecast_vintages=dataset.vintage_count,
            quality=DataQualityOut(
                actual_periods_expected=quality.actual_periods_expected,
                actual_periods_present=quality.actual_periods_present,
                missing_actual_periods=list(quality.missing_actual_periods),
                forecast_vintages=quality.forecast_vintages,
                forecast_points=quality.forecast_points,
                max_vintage_gap_hours=quality.max_vintage_gap_hours,
                duplicate_rows_dropped=quality.duplicate_rows_dropped,
                invalid_rows_dropped=quality.invalid_rows_dropped,
            ),
        ),
    )
