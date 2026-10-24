from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.domain.metrics import ErrorStats


class ApiModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class ProblemOut(BaseModel):
    """RFC 9457 problem details. Documented here; produced by app.core.errors."""

    type: str
    title: str
    status: int
    detail: str
    code: str = Field(description="Stable machine-readable error code")
    request_id: str | None = Field(description="Quote this when reporting an issue")


def mw(value: float) -> float:
    """MW values go out with one decimal: more is noise, and it trims payloads."""
    return round(value, 1)


def share(value: float) -> float:
    return round(value, 4)


class ErrorStatsOut(ApiModel):
    count: int = Field(description="Hourly points scored")
    mae_mw: float = Field(description="Mean absolute error")
    rmse_mw: float = Field(description="Root mean squared error (penalises large misses)")
    bias_mw: float = Field(
        description="Mean of forecast - actual. Positive: forecast promised more wind than came."
    )
    wape: float | None = Field(
        description="Sum of absolute errors / sum of actual output (0.18 = 18% of delivered energy)"
    )
    p50_abs_mw: float = Field(description="Median absolute error")
    p90_abs_mw: float = Field(description="90% of hours miss by less than this")
    p95_abs_mw: float
    p99_abs_mw: float
    max_abs_mw: float
    over_forecast_share: float = Field(description="Share of hours where forecast > actual")
    correlation: float | None = Field(description="Pearson correlation of forecast and actual")
    mean_forecast_mw: float
    mean_actual_mw: float

    @classmethod
    def from_stats(cls, stats: ErrorStats) -> ErrorStatsOut:
        return cls(
            count=stats.count,
            mae_mw=mw(stats.mae),
            rmse_mw=mw(stats.rmse),
            bias_mw=mw(stats.bias),
            wape=share(stats.wape) if stats.wape is not None else None,
            p50_abs_mw=mw(stats.p50_abs),
            p90_abs_mw=mw(stats.p90_abs),
            p95_abs_mw=mw(stats.p95_abs),
            p99_abs_mw=mw(stats.p99_abs),
            max_abs_mw=mw(stats.max_abs),
            over_forecast_share=share(stats.over_forecast_share),
            correlation=share(stats.correlation) if stats.correlation is not None else None,
            mean_forecast_mw=mw(stats.mean_forecast),
            mean_actual_mw=mw(stats.mean_actual),
        )

    @classmethod
    def maybe(cls, stats: ErrorStats | None) -> ErrorStatsOut | None:
        return cls.from_stats(stats) if stats is not None else None
