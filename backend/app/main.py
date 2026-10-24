"""Application factory.

`create_app()` wires settings, logging, middleware, error handlers, routes and
the dataset lifecycle together. Tests call it with their own settings and an
injected dataset; servers import the module-level `app`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.api.router import api_v1
from app.api.routes import health
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.http import build_middleware
from app.core.logging import configure_logging
from app.services.provider import DatasetProvider

DESCRIPTION = """
Day-ahead wind desk for GB power buyers.

* **Day-ahead** - the latest NESO wind forecast available at each auction's gate
  closure, with a look-ahead-free calibrated forecast and P10-P90 band.
* **Accuracy** - quantified forecast error (MAE, RMSE, bias, percentiles) by lead
  time, hour of day and wind level.

Data: Elexon Insights API (FUELHH wind outturn, WINDFOR wind forecast).
Errors are returned as RFC 9457 `application/problem+json`.
"""


def create_app(
    settings: Settings | None = None, *, provider: DatasetProvider | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_logs=settings.log_json)
    dataset_provider = provider or DatasetProvider(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await dataset_provider.start()
        yield
        await dataset_provider.aclose()

    docs = settings.docs_enabled
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
        docs_url="/api/docs" if docs else None,
        redoc_url="/api/redoc" if docs else None,
        openapi_url="/api/openapi.json" if docs else None,
        middleware=build_middleware(settings, lambda: dataset_provider.version),
    )
    app.state.settings = settings
    app.state.provider = dataset_provider

    register_exception_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(api_v1, prefix="/api/v1")

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {"name": settings.app_name, "version": __version__, "docs": "/api/docs"}

    return app


app = create_app()
