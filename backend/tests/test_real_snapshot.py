"""Golden numbers from the bundled January 2026 snapshot.

These pin the headline findings the product is pitched on. If a refactor moves
them, either the maths changed or the data did - both worth knowing about.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import BACKEND_DIR, Settings
from app.main import create_app

SNAPSHOT = BACKEND_DIR / "data" / "snapshot.json.gz"

pytestmark = [
    pytest.mark.snapshot,
    pytest.mark.skipif(not SNAPSHOT.exists(), reason="snapshot not generated"),
]


@pytest.fixture(scope="module")
def real() -> Iterator[TestClient]:
    settings = Settings(
        log_level="WARNING", data_mode="snapshot", snapshot_path=SNAPSHOT, rate_limit_per_minute=0
    )
    with TestClient(create_app(settings)) as c:
        yield c


def test_data_is_complete(real: TestClient) -> None:
    quality = real.get("/api/v1/meta").json()["dataset"]["quality"]
    assert quality["actual_periods_present"] == quality["actual_periods_expected"]
    assert quality["max_vintage_gap_hours"] <= 6


@pytest.mark.parametrize(
    ("gate", "raw_mae", "calibrated_mae"),
    [("09:20", 2022.5, 1311.9), ("09:50", 1995.6, 1292.1), ("15:30", 1886.3, 1173.9)],
)
def test_headline_accuracy(
    real: TestClient, gate: str, raw_mae: float, calibrated_mae: float
) -> None:
    body = real.get("/api/v1/accuracy/summary", params={"gate": gate}).json()
    assert body["raw"]["count"] == 744  # 31 delivery days x 24 hours
    assert body["raw"]["mae_mw"] == pytest.approx(raw_mae, abs=0.2)
    assert body["calibrated"]["mae_mw"] == pytest.approx(calibrated_mae, abs=0.2)
    assert 0.78 <= body["band_coverage"] <= 0.86  # an honest 80% band


def test_error_grows_with_lead_time(real: TestClient) -> None:
    buckets = {
        b["horizon_hours"]: b["mae_mw"]
        for b in real.get("/api/v1/accuracy/horizons").json()["buckets"]
    }
    assert buckets[0] < buckets[24] < buckets[48]
