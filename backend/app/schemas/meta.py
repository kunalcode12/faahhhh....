from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel


class GatePresetOut(ApiModel):
    id: str
    label: str
    venue: str
    product: str
    gate: str = Field(description="Gate closure, HH:MM UK local time on the day before delivery")
    results: str
    description: str


class CoverageOut(ApiModel):
    decision_date_from: date = Field(description="First purchase decision in scope")
    decision_date_to: date
    delivery_date_from: date = Field(description="First delivery day (decision + 1)")
    delivery_date_to: date
    timezone: str = "Europe/London"


class DataQualityOut(ApiModel):
    actual_periods_expected: int
    actual_periods_present: int
    missing_actual_periods: list[datetime]
    forecast_vintages: int
    forecast_points: int
    max_vintage_gap_hours: float
    duplicate_rows_dropped: int
    invalid_rows_dropped: int


class DatasetOut(ApiModel):
    version: str = Field(description="Content hash of the loaded data; changes when data changes")
    source: str
    origin: Literal["snapshot", "live", "injected"]
    generated_at: datetime
    loaded_at: datetime
    actual_days_from: date
    actual_days_to: date
    actual_points: int
    forecast_points: int
    forecast_vintages: int
    quality: DataQualityOut


class DefaultsOut(ApiModel):
    gate: str
    lookback_days: int
    horizon_hours: int


class LimitsOut(ApiModel):
    lookback_days_options: list[int]
    lookback_days_min: int
    lookback_days_max: int
    horizon_hours_max: int


class MetaOut(ApiModel):
    name: str
    version: str
    coverage: CoverageOut
    gates: list[GatePresetOut]
    defaults: DefaultsOut
    limits: LimitsOut
    dataset: DatasetOut


class HealthOut(ApiModel):
    status: Literal["ok", "ready"]
    dataset_version: str | None = None
    origin: str | None = None
