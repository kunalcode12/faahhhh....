"""Cross-cutting HTTP behaviour: caching, request ids, rate limits, failure modes."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.http import ResponseCache
from app.domain.dataset import WindDataset
from app.main import create_app
from app.services.provider import DatasetProvider

DAY_AHEAD = "/api/v1/day-ahead/2026-01-03"


def test_etag_revalidation_returns_304(client: TestClient) -> None:
    first = client.get(DAY_AHEAD)
    etag = first.headers["etag"]
    assert etag.startswith('W/"')
    assert "s-maxage" in first.headers["cache-control"]

    again = client.get(DAY_AHEAD, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""

    other = client.get(DAY_AHEAD, params={"gate": "09:20"}, headers={"If-None-Match": etag})
    assert other.status_code == 200  # different URL, different representation


def test_repeat_requests_are_served_from_the_render_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = client.get(DAY_AHEAD)
    bundle = client.app.state.provider.bundle()  # type: ignore[attr-defined]

    def must_not_run(*_: object) -> None:
        raise AssertionError("cache miss: the endpoint ran again")

    monkeypatch.setattr(bundle.day_ahead, "view", must_not_run)
    second = client.get(DAY_AHEAD)
    assert second.status_code == 200
    assert second.content == first.content
    assert second.headers["etag"] == first.headers["etag"]
    assert second.headers["x-request-id"] != first.headers["x-request-id"]  # outer layers still run


def test_cache_hits_do_not_leak_headers_between_requests(client: TestClient) -> None:
    # Regression: outer middleware mutates headers in place; a shared cached
    # header list once picked up a gzip content-length and broke the next response.
    first = client.get(DAY_AHEAD, headers={"Accept-Encoding": "identity"})  # miss
    zipped = client.get(DAY_AHEAD, headers={"Accept-Encoding": "gzip"})  # hit, gzip edits headers
    assert zipped.headers["content-encoding"] == "gzip"
    plain = client.get(DAY_AHEAD, headers={"Accept-Encoding": "identity"})  # hit after gzip
    assert "content-encoding" not in plain.headers
    assert int(plain.headers["content-length"]) == len(plain.content)
    assert plain.json() == zipped.json() == first.json()
    for response in (plain, zipped):
        assert len(response.headers.get_list("x-request-id")) == 1
        assert len(response.headers.get_list("etag")) == 1


def test_render_cache_evicts_least_recently_used() -> None:
    cache = ResponseCache(max_bytes=80)
    cache.put("a", [], b"x" * 10)
    cache.put("b", [], b"x" * 10)
    assert cache.get("a") is not None  # "a" is now most recently used
    for key in "cdefghi":  # 9 x 10 bytes > 80: the least recently used entry ("b") goes
        cache.put(key, [], b"x" * 10)
    assert cache.size <= 80
    assert cache.get("b") is None
    assert cache.get("a") is not None
    cache.put("huge", [], b"x" * 50)  # > 1/8 of the budget: never cached
    assert cache.get("huge") is None


def test_query_order_does_not_change_the_etag(client: TestClient) -> None:
    a = client.get("/api/v1/accuracy/summary?mode=gate&gate=09:50").headers["etag"]
    b = client.get("/api/v1/accuracy/summary?gate=09:50&mode=gate").headers["etag"]
    assert a == b


def test_request_id_is_propagated_or_generated(client: TestClient) -> None:
    assert (
        client.get("/api/health/live", headers={"X-Request-ID": "trace-123"}).headers[
            "x-request-id"
        ]
        == "trace-123"
    )
    generated = client.get("/api/health/live", headers={"X-Request-ID": "bad id\nwith newline"})
    assert generated.headers["x-request-id"] != "bad id\nwith newline"
    assert len(generated.headers["x-request-id"]) == 32


def test_security_headers(client: TestClient) -> None:
    headers = client.get("/api/v1/meta").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in headers["content-security-policy"]
    assert "app;dur=" in headers["server-timing"]
    # Swagger UI must still be able to load its scripts.
    assert "content-security-policy" not in client.get("/api/docs").headers


def test_large_responses_are_compressed(client: TestClient) -> None:
    response = client.get("/api/v1/accuracy/series", headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"


def test_rate_limit(settings: Settings, dataset: WindDataset) -> None:
    limited = settings.model_copy(update={"rate_limit_per_minute": 60, "rate_limit_burst": 2})
    app = create_app(limited, provider=DatasetProvider(limited, dataset=dataset))
    with TestClient(app) as c:
        assert c.get("/api/v1/meta").status_code == 200
        assert c.get("/api/v1/meta").status_code == 200
        blocked = c.get("/api/v1/meta")
        assert blocked.status_code == 429
        assert blocked.json()["code"] == "rate_limited"
        assert int(blocked.headers["retry-after"]) >= 1
        # Health probes are never limited.
        assert c.get("/api/health/live").status_code == 200


def test_unavailable_dataset_degrades_gracefully(tmp_path: Path) -> None:
    settings = Settings(
        environment="test",
        log_level="ERROR",
        data_mode="snapshot",
        snapshot_path=tmp_path / "missing.json.gz",
        rate_limit_per_minute=0,
    )
    with TestClient(create_app(settings)) as c:
        assert c.get("/api/health/live").status_code == 200
        ready = c.get("/api/health/ready")
        assert ready.status_code == 503
        data = c.get(DAY_AHEAD)
        assert data.status_code == 503
        assert data.json()["code"] == "dataset_unavailable"
        assert data.headers["retry-after"] == "5"


def test_unhandled_errors_become_a_generic_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = client.app.state.provider.bundle()  # type: ignore[attr-defined]

    def explode(*_: object) -> None:
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(bundle.day_ahead, "view", explode)
    response = client.get("/api/v1/day-ahead/2026-01-02")
    assert response.status_code == 500
    body = response.json()
    assert body["code"] == "internal_error"
    assert "secret" not in response.text
    assert body["request_id"] == response.headers["x-request-id"]


def test_cors_allows_the_configured_frontend(client: TestClient) -> None:
    response = client.get("/api/v1/meta", headers={"Origin": "http://localhost:3000"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    blocked = client.get("/api/v1/meta", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers


def test_settings_accept_comma_separated_origins() -> None:
    settings = Settings(
        cors_origins="https://a.app, https://b.app", decision_date_from=date(2026, 1, 1)
    )  # type: ignore[arg-type]
    assert settings.cors_origins == ["https://a.app", "https://b.app"]
