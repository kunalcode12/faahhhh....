from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import PROBLEM_RESPONSES, BundleDep, SettingsDep
from app.schemas.meta import MetaOut
from app.services.meta import build_meta

router = APIRouter(tags=["Meta"])


@router.get(
    "/meta",
    summary="Coverage, auction presets, defaults and data health",
    responses={503: PROBLEM_RESPONSES[503]},
)
def meta(bundle: BundleDep, settings: SettingsDep) -> MetaOut:
    return build_meta(settings, bundle)
