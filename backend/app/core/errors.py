"""Error model.

All failures leave the API as RFC 9457 "problem details" JSON
(`application/problem+json`), so clients get one predictable shape:

    {"type": ..., "title": ..., "status": 404, "detail": ..., "code": "...",
     "request_id": "..."}

Domain code raises the `AppError` subclasses below; it never builds HTTP
responses itself.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

logger = logging.getLogger(__name__)

PROBLEM_JSON = "application/problem+json"


class AppError(Exception):
    status_code = 500
    code = "internal_error"
    title = "Internal server error"

    def __init__(
        self,
        detail: str,
        *,
        extra: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.extra = extra or {}
        self.headers = headers or {}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    title = "Not found"


class OutOfCoverageError(AppError):
    """The request asks for dates this deployment holds no data for."""

    status_code = 404
    code = "out_of_coverage"
    title = "Outside data coverage"


class InvalidRequestError(AppError):
    status_code = 422
    code = "invalid_request"
    title = "Invalid request"


class DatasetUnavailableError(AppError):
    """Raised while the dataset is still loading or after a failed load."""

    status_code = 503
    code = "dataset_unavailable"
    title = "Data not available yet"


class UpstreamError(AppError):
    """Elexon could not be reached or returned something unusable."""

    status_code = 502
    code = "upstream_error"
    title = "Upstream data source failed"


def problem_response(
    status: int,
    title: str,
    detail: str,
    *,
    code: str,
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"https://beaufort.app/problems/{code.replace('_', '-')}",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code,
        "request_id": request_id_var.get(),
    }
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status, headers=headers, media_type=PROBLEM_JSON)


# Starlette dispatches handlers by exception type, so the isinstance checks
# below never fail; they exist to narrow the type for the checker.


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, AppError):
        raise exc
    if exc.status_code >= 500:
        logger.warning("request failed: %s", exc.detail, extra={"error_code": exc.code})
    return problem_response(
        exc.status_code, exc.title, exc.detail, code=exc.code, extra=exc.extra, headers=exc.headers
    )


async def _validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise exc
    errors = [
        {
            "location": ".".join(str(part) for part in err.get("loc", ())),
            "message": err.get("msg", "invalid value"),
        }
        for err in exc.errors()
    ]
    return problem_response(
        422,
        "Invalid request",
        "One or more parameters are invalid.",
        code="validation_error",
        extra={"errors": errors},
    )


async def _http_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        raise exc
    titles = {404: "Not found", 405: "Method not allowed"}
    return problem_response(
        exc.status_code,
        titles.get(exc.status_code, "Request failed"),
        str(exc.detail),
        code="not_found" if exc.status_code == 404 else "http_error",
        headers=dict(exc.headers or {}),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_error_handler)
    # Anything unhandled is caught by RequestContextMiddleware, which logs the
    # stack trace and answers with a generic 500 problem (no internals leaked).
