"""Look-ahead-free calibration of the day-ahead forecast.

What the January 2026 data shows: NESO's wind forecast runs high against
metered outturn, and the gap grows with wind speed (output appears capped
around 17-18 GW while forecasts reach 21 GW, consistent with transmission
constraints curtailing wind). A *multiplicative* correction therefore fits far
better than an additive one.

For delivery day D, decided at gate closure on D-1, we look only at days whose
outturn was fully metered by then (D-2 and earlier) and learn two things:

1. realisation rate  rho = sum(actual) / sum(forecast)
   -> calibrated forecast = rho * forecast
2. the empirical 10th / 90th percentiles of (actual - rho * forecast)
   -> an 80% band: P10 = calibrated + q10, P90 = calibrated + q90

Backtest over January 2026 (14-day lookback, 09:50 gate): MAE falls from
2.0 GW to 1.3 GW and the P10-P90 band covers ~82% of outcomes (target 80%).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from app.domain.metrics import quantile

# Three days of hourly points; below this the percentiles are not meaningful.
MIN_SAMPLES = 72
LOOKBACK_OPTIONS = (7, 14, 21, 28)
DEFAULT_LOOKBACK_DAYS = 14


@dataclass(frozen=True, slots=True)
class Calibration:
    lookback_days: int
    history_from: date
    history_to: date
    sample_size: int
    realisation_rate: float
    residual_p10: float
    residual_p90: float

    def expected(self, forecast_mw: float) -> float:
        return max(0.0, self.realisation_rate * forecast_mw)

    def band(self, forecast_mw: float) -> tuple[float, float]:
        """(P10, P90): 80% of outcomes are expected to land between the two."""
        centre = self.realisation_rate * forecast_mw
        return max(0.0, centre + self.residual_p10), max(0.0, centre + self.residual_p90)


def fit_calibration(
    pairs: Sequence[tuple[float, float]],
    *,
    lookback_days: int,
    history_from: date,
    history_to: date,
) -> Calibration | None:
    """Fit from `(forecast, actual)` pairs. None when history is too thin to trust."""
    if len(pairs) < MIN_SAMPLES:
        return None
    total_forecast = math.fsum(f for f, _ in pairs)
    if total_forecast <= 0:
        return None
    rate = math.fsum(a for _, a in pairs) / total_forecast
    residuals = sorted(a - rate * f for f, a in pairs)
    return Calibration(
        lookback_days=lookback_days,
        history_from=history_from,
        history_to=history_to,
        sample_size=len(pairs),
        realisation_rate=rate,
        residual_p10=quantile(residuals, 0.10),
        residual_p90=quantile(residuals, 0.90),
    )
