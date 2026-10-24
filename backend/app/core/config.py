"""Application settings, read from environment variables (12-factor style).

Every setting has a safe default so `uvicorn app.main:app` works with zero setup.
Deployments override values through the environment - see `.env.example`.
"""

from __future__ import annotations

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Service -----------------------------------------------------------------
    app_name: str = "Beaufort API"
    environment: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_json: bool = True
    docs_enabled: bool = True

    # --- HTTP edge ---------------------------------------------------------------
    # Comma-separated in the environment: CORS_ORIGINS=https://a.app,https://b.app
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    # Behind Render / Vercel / a load balancer the client IP is in X-Forwarded-For.
    trust_proxy_headers: bool = True
    # Per-client token bucket. 0 disables rate limiting.
    rate_limit_per_minute: int = Field(default=600, ge=0)
    rate_limit_burst: int = Field(default=120, ge=1)
    # Browser cache lifetime and shared (CDN) cache lifetime for data endpoints.
    cache_max_age_seconds: int = Field(default=300, ge=0)
    cache_shared_max_age_seconds: int = Field(default=86_400, ge=0)
    # In-process cache of rendered JSON responses, per worker. 0 disables it.
    response_cache_mb: int = Field(default=32, ge=0)

    # --- Data --------------------------------------------------------------------
    # snapshot: only load the bundled file. live: always fetch from Elexon.
    # auto: use the snapshot if present, otherwise fetch live (and save it).
    data_mode: Literal["auto", "snapshot", "live"] = "auto"
    snapshot_path: Path = BACKEND_DIR / "data" / "snapshot.json.gz"
    # Where a live fetch is persisted. Defaults to snapshot_path; point it at /tmp
    # on read-only filesystems.
    live_cache_path: Path | None = None
    # Purchase decisions in scope. Delivery days are the day after each decision.
    decision_date_from: date = date(2026, 1, 1)
    decision_date_to: date = date(2026, 1, 31)
    # Settled days fetched before the first delivery day so that calibration for
    # early-January decisions can look back without peeking into the future.
    history_days: int = Field(default=30, ge=7, le=120)
    dataset_retry_seconds: float = Field(default=30.0, gt=0)

    # --- Elexon Insights API -----------------------------------------------------
    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    elexon_timeout_seconds: float = Field(default=30.0, gt=0)
    elexon_max_attempts: int = Field(default=5, ge=1, le=10)
    elexon_concurrency: int = Field(default=4, ge=1, le=16)
    elexon_chunk_days: int = Field(default=7, ge=1, le=31)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _check_window(self) -> Settings:
        if self.decision_date_from > self.decision_date_to:
            raise ValueError("decision_date_from must be on or before decision_date_to")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
