from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.domain.dataset import WindDataset
from app.main import create_app
from app.services.provider import DatasetProvider
from tests.factories import synthetic_dataset


@pytest.fixture(scope="session")
def dataset() -> WindDataset:
    return synthetic_dataset()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # Decisions 1-3 Jan -> delivery days 2-4 Jan, matching the synthetic data.
    return Settings(
        environment="test",
        log_level="WARNING",
        log_json=False,
        data_mode="snapshot",
        snapshot_path=tmp_path / "missing.json.gz",
        decision_date_from=date(2026, 1, 1),
        decision_date_to=date(2026, 1, 3),
        history_days=14,
        rate_limit_per_minute=0,
    )


@pytest.fixture
def client(settings: Settings, dataset: WindDataset) -> Iterator[TestClient]:
    app = create_app(settings, provider=DatasetProvider(settings, dataset=dataset))
    with TestClient(app) as test_client:
        yield test_client
