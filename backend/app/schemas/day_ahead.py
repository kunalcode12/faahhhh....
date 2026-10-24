from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, ErrorStatsOut


class GateOut(ApiModel):
    local_time: str = Field(description="HH:MM UK local time on the day before delivery")
    closes_at: datetime = Field(description="Gate closure instant (UTC)")


class VintageRefOut(ApiModel):
    published_at: datetime = Field(description="Publish time of the forecast run used")
    minutes_before_gate: int


class CalibrationOut(ApiModel):
    lookback_days: int
    history_from: date
    history_to: date
    sample_size: int
    realisation_rate: float = Field(
        description="Sum of actual / sum of forecast over the trailing window (0.85: 85% came)"
    )
    residual_p10_mw: float
    residual_p90_mw: float


class PeakOut(ApiModel):
    mw: float
    start_time: datetime


class DaySummaryOut(ApiModel):
    forecast_energy_mwh: float
    calibrated_energy_mwh: float | None
    actual_energy_mwh: float | None = Field(
        description="From half-hourly outturn; null until every settlement period is metered"
    )
    forecast_peak: PeakOut
    forecast_trough: PeakOut
    forecast_mean_mw: float
    raw_error: ErrorStatsOut | None
    calibrated_error: ErrorStatsOut | None
    band_coverage: float | None = Field(
        description="Share of hours whose outturn landed inside the P10-P90 band"
    )


class HourOut(ApiModel):
    start_time: datetime
    settlement_period: int
    forecast_mw: float = Field(description="As published in the run available at gate closure")
    calibrated_mw: float | None
    p10_mw: float | None = Field(description="90% chance outturn is at least this")
    p90_mw: float | None = Field(description="10% chance outturn exceeds this")
    actual_mw: float | None
    error_mw: float | None = Field(description="forecast - actual")
    calibrated_error_mw: float | None
    published_at: datetime
    horizon_hours: float


class HalfHourOut(ApiModel):
    start_time: datetime
    settlement_period: int
    actual_mw: float


class DayAheadOut(ApiModel):
    delivery_date: date
    settlement_periods: int = Field(description="48 normally; 46 or 50 on clock-change days")
    gate: GateOut
    vintage: VintageRefOut
    calibration: CalibrationOut | None
    summary: DaySummaryOut
    hours: list[HourOut]
    actuals: list[HalfHourOut]
    notes: list[str]


class PointOut(ApiModel):
    start_time: datetime
    mw: float


class VintageOut(ApiModel):
    published_at: datetime
    status: Literal["used", "before_gate", "after_gate"]
    hours_ahead_of_delivery: float = Field(
        description="Hours between publication and the start of the delivery day"
    )
    energy_mwh: float
    points: list[PointOut]


class VintageEvolutionOut(ApiModel):
    delivery_date: date
    gate: GateOut
    actual_energy_mwh: float | None
    actual_hourly: list[PointOut] = Field(description="Outturn at each forecast hour")
    vintages: list[VintageOut]
