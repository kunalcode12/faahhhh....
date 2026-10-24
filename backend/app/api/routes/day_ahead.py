"""Purpose 1 - the latest forecast available when the desk has to bid."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from app.api.deps import DEFAULT_LOOKBACK, PROBLEM_RESPONSES, BundleDep, GateDep, LookbackQuery
from app.schemas.day_ahead import DayAheadOut, VintageEvolutionOut

router = APIRouter(prefix="/day-ahead", tags=["Day-ahead"], responses=PROBLEM_RESPONSES)

# Route functions are plain `def`: FastAPI runs them in a worker thread, so the
# (brief, CPU-bound) computation never blocks the event loop.


@router.get(
    "/{delivery_date}",
    summary="Forecast available at gate closure for one delivery day",
    description=(
        "Uses the latest WINDFOR run published strictly before the auction gate on the day "
        "before delivery, plus a calibrated forecast and P10-P90 band learned from the "
        "trailing settled days, and the outturn once metered."
    ),
)
def day_ahead(
    delivery_date: date,
    bundle: BundleDep,
    gate: GateDep,
    lookback_days: LookbackQuery = DEFAULT_LOOKBACK,
) -> DayAheadOut:
    return bundle.day_ahead.view(delivery_date, gate, lookback_days)


@router.get(
    "/{delivery_date}/vintages",
    summary="How the forecast for one delivery day evolved run by run",
)
def vintages(delivery_date: date, bundle: BundleDep, gate: GateDep) -> VintageEvolutionOut:
    return bundle.day_ahead.evolution(delivery_date, gate)
