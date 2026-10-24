from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import accuracy, day_ahead, meta

# Version 1 of the public API, mounted at /api/v1. A breaking change would ship
# as /api/v2 alongside it rather than changing these contracts in place.
api_v1 = APIRouter()
api_v1.include_router(meta.router)
api_v1.include_router(day_ahead.router)
api_v1.include_router(accuracy.router)
