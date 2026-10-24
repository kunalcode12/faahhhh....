"""Endpoint behaviour against synthetic data with known answers.

Synthetic forecasts are exactly 25% above outturn, so: raw bias = MAE = 2.5 GW,
realisation rate = 0.8 and the calibrated forecast lands on the outturn.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_meta_describes_coverage_and_presets(client: TestClient) -> None:
    body = client.get("/api/v1/meta").json()
    assert body["coverage"]["delivery_date_from"] == "2026-01-02"
    assert body["coverage"]["delivery_date_to"] == "2026-01-04"
    assert [g["gate"] for g in body["gates"]] == ["09:20", "09:50", "15:30"]
    assert body["defaults"] == {"gate": "09:50", "lookback_days": 14, "horizon_hours": 24}
    assert body["dataset"]["origin"] == "injected"


def test_day_ahead_view(client: TestClient) -> None:
    body = client.get("/api/v1/day-ahead/2026-01-03", params={"gate": "09:50"}).json()
    assert body["settlement_periods"] == 48
    assert body["gate"] == {"local_time": "09:50", "closes_at": "2026-01-02T09:50:00Z"}
    assert body["vintage"] == {"published_at": "2026-01-02T09:30:00Z", "minutes_before_gate": 20}
    assert len(body["hours"]) == 24
    assert len(body["actuals"]) == 48

    first = body["hours"][0]
    assert first["settlement_period"] == 1
    assert first["horizon_hours"] == 14.5
    assert first["forecast_mw"] == pytest.approx(first["actual_mw"] * 1.25, abs=0.1)
    assert first["calibrated_mw"] == pytest.approx(first["actual_mw"], abs=0.1)

    summary = body["summary"]
    assert summary["raw_error"]["bias_mw"] == pytest.approx(2500, abs=1)
    assert summary["calibrated_error"]["mae_mw"] < 1
    assert body["calibration"]["realisation_rate"] == pytest.approx(0.8)


def test_gate_choice_changes_the_run_used(client: TestClient) -> None:
    early = client.get("/api/v1/day-ahead/2026-01-03", params={"gate": "09:20"}).json()
    late = client.get("/api/v1/day-ahead/2026-01-03", params={"gate": "15:30"}).json()
    assert early["vintage"]["published_at"] == "2026-01-02T07:30:00Z"
    assert late["vintage"]["published_at"] == "2026-01-02T11:30:00Z"


def test_vintage_evolution_labels_runs_against_the_gate(client: TestClient) -> None:
    body = client.get("/api/v1/day-ahead/2026-01-03/vintages").json()
    statuses = {
        v["published_at"][11:16]: v["status"]
        for v in body["vintages"]
        if v["published_at"].startswith("2026-01-02")
    }
    assert statuses["07:30"] == "before_gate"
    assert statuses["09:30"] == "used"
    assert statuses["11:30"] == "after_gate"
    assert len(body["actual_hourly"]) == 24


def test_accuracy_summary_gate_mode(client: TestClient) -> None:
    body = client.get("/api/v1/accuracy/summary").json()
    assert body["window"]["mode"] == "gate"
    assert body["raw"]["count"] == 72  # 3 delivery days x 24 hours
    assert body["raw"]["bias_mw"] == pytest.approx(2500, abs=1)
    assert body["raw"]["over_forecast_share"] == 1.0
    assert body["calibrated"]["mae_mw"] < 1
    assert body["lead_time_hours"] == [14.5, 37.5]
    assert [row["hour"] for row in body["by_hour"]] == list(range(24))
    assert len(body["daily"]) == 3


def test_accuracy_summary_horizon_mode(client: TestClient) -> None:
    body = client.get(
        "/api/v1/accuracy/summary", params={"mode": "horizon", "horizon_hours": 6}
    ).json()
    assert body["window"] == {
        "start": "2026-01-02",
        "end": "2026-01-04",
        "mode": "horizon",
        "gate": None,
        "horizon_hours": 6,
        "lookback_days": None,
    }
    assert body["calibrated"] is None
    assert body["lead_time_hours"][0] >= 6


def test_series_and_horizon_curve(client: TestClient) -> None:
    series = client.get(
        "/api/v1/accuracy/series", params={"start": "2026-01-02", "end": "2026-01-02"}
    ).json()
    assert len(series["forecasts"]) == 24
    assert len(series["actuals"]) == 48

    curve = client.get("/api/v1/accuracy/horizons").json()
    leads = [b["horizon_hours"] for b in curve["buckets"]]
    assert leads == list(range(49))


@pytest.mark.parametrize(
    ("path", "params", "status", "code"),
    [
        ("/api/v1/day-ahead/2026-03-01", {}, 404, "out_of_coverage"),
        ("/api/v1/day-ahead/2026-01-03", {"gate": "25:00"}, 422, "validation_error"),
        ("/api/v1/day-ahead/2026-01-03", {"lookback_days": 2}, 422, "validation_error"),
        ("/api/v1/day-ahead/not-a-date", {}, 422, "validation_error"),
        (
            "/api/v1/accuracy/summary",
            {"start": "2026-01-04", "end": "2026-01-02"},
            422,
            "invalid_request",
        ),
        ("/api/v1/accuracy/summary", {"start": "2025-12-01"}, 404, "out_of_coverage"),
        ("/api/v1/accuracy/summary", {"mode": "weekly"}, 422, "validation_error"),
        ("/api/v1/nope", {}, 404, "not_found"),
    ],
)
def test_errors_are_problem_details(
    client: TestClient, path: str, params: dict[str, str], status: int, code: str
) -> None:
    response = client.get(path, params=params)
    assert response.status_code == status
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["code"] == code
    assert body["status"] == status
    assert body["request_id"] == response.headers["x-request-id"]
    assert response.headers.get("cache-control") in (None, "no-store")
