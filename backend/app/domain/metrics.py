"""Forecast error metrics.

Sign convention everywhere: error = forecast - actual.

A positive error means the forecast promised more wind than turned up. For a
buyer that is the expensive direction: they under-buy day-ahead and top up
later, usually at worse prices. So "bias" here is directly a risk number.
"""

from __future__ import annotations

import math
import statistics
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass


def quantile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolation quantile (numpy's default, Excel's PERCENTILE.INC).

    `sorted_values` must already be sorted ascending.
    """
    if not sorted_values:
        raise ValueError("quantile of an empty sequence")
    if not 0.0 <= q <= 1.0:
        raise ValueError("q must be within [0, 1]")
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(sorted_values[lower])
    fraction = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


@dataclass(frozen=True, slots=True)
class ErrorStats:
    count: int
    mae: float  # mean absolute error
    rmse: float  # root mean squared error - punishes big misses
    bias: float  # mean error; > 0 = systematic over-forecast
    wape: float | None  # sum|error| / sum(actual): MAE relative to the energy delivered
    p50_abs: float
    p90_abs: float
    p95_abs: float
    p99_abs: float
    max_abs: float
    over_forecast_share: float  # share of periods where forecast > actual
    correlation: float | None  # shape agreement, independent of bias
    mean_forecast: float
    mean_actual: float


def error_stats(pairs: Sequence[tuple[float, float]]) -> ErrorStats | None:
    """Summary statistics for `(forecast, actual)` pairs. None when there are none."""
    if not pairs:
        return None
    forecasts = [f for f, _ in pairs]
    actuals = [a for _, a in pairs]
    errors = [f - a for f, a in pairs]
    abs_sorted = sorted(abs(e) for e in errors)
    total_actual = math.fsum(actuals)

    try:
        correlation: float | None = statistics.correlation(forecasts, actuals)
    except statistics.StatisticsError:  # fewer than two points, or a flat series
        correlation = None

    return ErrorStats(
        count=len(pairs),
        mae=statistics.fmean(abs_sorted),
        rmse=math.sqrt(statistics.fmean(e * e for e in errors)),
        bias=statistics.fmean(errors),
        wape=math.fsum(abs_sorted) / total_actual if total_actual > 0 else None,
        p50_abs=quantile(abs_sorted, 0.50),
        p90_abs=quantile(abs_sorted, 0.90),
        p95_abs=quantile(abs_sorted, 0.95),
        p99_abs=quantile(abs_sorted, 0.99),
        max_abs=abs_sorted[-1],
        over_forecast_share=sum(1 for e in errors if e > 0) / len(errors),
        correlation=correlation,
        mean_forecast=statistics.fmean(forecasts),
        mean_actual=statistics.fmean(actuals),
    )


def error_stats_of(pairs: Sequence[tuple[float, float]]) -> ErrorStats:
    """`error_stats` for callers that guarantee at least one pair (e.g. a non-empty group)."""
    stats = error_stats(pairs)
    if stats is None:
        raise ValueError("cannot score an empty group")
    return stats


@dataclass(frozen=True, slots=True)
class HistogramBin:
    lower: float
    upper: float
    count: int


def histogram(values: Iterable[float], width: float) -> list[HistogramBin]:
    """Fixed-width bins aligned to multiples of `width`, so 0 is always an edge.

    Empty bins inside the range are kept, so the shape reads correctly.
    """
    if width <= 0:
        raise ValueError("bin width must be positive")
    counts = Counter(math.floor(v / width) for v in values)
    if not counts:
        return []
    return [
        HistogramBin(lower=k * width, upper=(k + 1) * width, count=counts.get(k, 0))
        for k in range(min(counts), max(counts) + 1)
    ]
