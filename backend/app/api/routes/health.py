"""Probes for orchestrators and load balancers. Never cached, never rate limited."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import PROBLEM_RESPONSES, ProviderDep
from app.schemas.meta import HealthOut

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("/live", summary="Liveness: the process is up")
async def live() -> HealthOut:
    return HealthOut(status="ok")


@router.get(
    "/ready",
    summary="Readiness: data is loaded and requests can be served",
    responses={503: PROBLEM_RESPONSES[503]},
)
async def ready(provider: ProviderDep) -> HealthOut:
    bundle = provider.bundle()
    return HealthOut(status="ready", dataset_version=bundle.dataset.version, origin=bundle.origin)
