from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, ErrorStatsOut

Mode = Literal["gate", "horizon"]


class WindowOut(ApiModel):
    start: date
    end: date
    mode: Mode
    gate: str | None = Field(description="HH:MM, gate mode only")
    horizon_hours: int | None = Field(description="Minimum lead time, horizon mode only")
    lookback_days: int | None = Field(description="Calibration lookback, gate mode only")


class HourOfDayOut(ApiModel):
    hour: int = Field(description="UK local hour of the target")
    count: int
    mae_mw: float
    bias_mw: float
    p90_abs_mw: float


class LevelBucketOut(ApiModel):
    lower_mw: float
    upper_mw: float
    count: int
    mae_mw: float
    bias_mw: float
    realisation_rate: float = Field(description="Sum of actual / sum of forecast in this bucket")


class HistogramBinOut(ApiModel):
    lower_mw: float
    upper_mw: float
    count: int


class DailyOut(ApiModel):
    delivery_date: date
    mae_mw: float
    bias_mw: float
    calibrated_mae_mw: float | None
    forecast_energy_mwh: float
    actual_energy_mwh: float


class AccuracySummaryOut(ApiModel):
    window: WindowOut
    raw: ErrorStatsOut | None
    calibrated: ErrorStatsOut | None = Field(description="Gate mode only")
    band_coverage: float | None = Field(description="Share of outcomes inside P10-P90 (gate mode)")
    lead_time_hours: tuple[float, float] | None = Field(
        description="Shortest and longest lead time among scored forecasts"
    )
    by_hour: list[HourOfDayOut]
    by_level: list[LevelBucketOut]
    distribution: list[HistogramBinOut]
    daily: list[DailyOut]


class SeriesForecastOut(ApiModel):
    start_time: datetime
    forecast_mw: float
    published_at: datetime
    horizon_hours: float
    actual_mw: float | None


class SeriesActualOut(ApiModel):
    start_time: datetime
    actual_mw: float


class AccuracySeriesOut(ApiModel):
    window: WindowOut
    forecasts: list[SeriesForecastOut]
    actuals: list[SeriesActualOut]


class HorizonBucketOut(ApiModel):
    horizon_hours: int = Field(description="Lead time bucket [h, h+1) hours")
    count: int
    mae_mw: float
    rmse_mw: float
    bias_mw: float
    p90_abs_mw: float


class HorizonCurveOut(ApiModel):
    start: date
    end: date
    buckets: list[HorizonBucketOut]
