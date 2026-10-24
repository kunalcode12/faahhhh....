"""Purpose 2 - quantified forecast accuracy over a window of delivery days."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import DEFAULT_LOOKBACK, PROBLEM_RESPONSES, BundleDep, GateDep, LookbackQuery
from app.domain.gates import DEFAULT_GATE
from app.schemas.accuracy import AccuracySeriesOut, AccuracySummaryOut, HorizonCurveOut, Mode
from app.services.accuracy import MAX_HORIZON_HOURS, AccuracyQuery
from app.services.meta import DEFAULT_HORIZON_HOURS

router = APIRouter(prefix="/accuracy", tags=["Accuracy"], responses=PROBLEM_RESPONSES)

StartQuery = Annotated[
    date | None, Query(description="First delivery day (default: start of coverage)")
]
EndQuery = Annotated[date | None, Query(description="Last delivery day (default: end of coverage)")]


def _query(
    bundle: BundleDep,
    gate: GateDep,
    start: StartQuery = None,
    end: EndQuery = None,
    mode: Annotated[
        Mode,
        Query(
            description="`gate`: run available at the auction gate on D-1. "
            "`horizon`: latest run published at least `horizon_hours` before each target."
        ),
    ] = "gate",
    horizon_hours: Annotated[
        int, Query(ge=0, le=MAX_HORIZON_HOURS, description="Minimum lead time (horizon mode)")
    ] = DEFAULT_HORIZON_HOURS,
    lookback_days: LookbackQuery = DEFAULT_LOOKBACK,
) -> AccuracyQuery:
    gate_mode = mode == "gate"
    # Parameters irrelevant to the chosen mode are normalised so they share a cache entry.
    return AccuracyQuery(
        start=start or bundle.coverage.delivery_from,
        end=end or bundle.coverage.delivery_to,
        mode=mode,
        gate=gate if gate_mode else DEFAULT_GATE,
        horizon_hours=DEFAULT_HORIZON_HOURS if gate_mode else horizon_hours,
        lookback_days=lookback_days if gate_mode else DEFAULT_LOOKBACK,
    )


QueryDep = Annotated[AccuracyQuery, Depends(_query)]


@router.get("/summary", summary="Error statistics, breakdowns and calibration effect")
def summary(q: QueryDep, bundle: BundleDep) -> AccuracySummaryOut:
    return bundle.accuracy.summary(q)


@router.get("/series", summary="Forecast vs actual time series for charting")
def series(q: QueryDep, bundle: BundleDep) -> AccuracySeriesOut:
    return bundle.accuracy.series(q)


@router.get("/horizons", summary="Error by lead time (0-48h), across every forecast run")
def horizons(bundle: BundleDep, start: StartQuery = None, end: EndQuery = None) -> HorizonCurveOut:
    return bundle.accuracy.horizon_curve(
        start or bundle.coverage.delivery_from, end or bundle.coverage.delivery_to
    )
