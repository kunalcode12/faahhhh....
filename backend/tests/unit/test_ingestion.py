"""Normalisation rules and the snapshot round trip."""

from __future__ import annotations

import gzip
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.ingestion.elexon import FuelHHRow, WindForRow
from app.ingestion.normalize import normalize
from app.ingestion.pipeline import IngestWindow, to_dataset
from app.ingestion.snapshot import SnapshotError, read_snapshot, write_snapshot
from tests.factories import utc

DAY = date(2026, 1, 15)
WINDOW = ((DAY, DAY), (utc(2026, 1, 14), utc(2026, 1, 16)))


def fuel(
    sp: int,
    mw: float | None,
    *,
    published: str = "2026-01-15T12:00:00Z",
    fuel_type: str = "WIND",
) -> FuelHHRow:
    start = utc(2026, 1, 15) + timedelta(minutes=30 * (sp - 1))
    return FuelHHRow.model_validate(
        {
            "publishTime": published,
            "startTime": start.isoformat(),
            "settlementDate": DAY.isoformat(),
            "settlementPeriod": sp,
            "fuelType": fuel_type,
            "generation": mw,
        }
    )


def forecast(published_hour: int, target_hour: int, mw: float | None) -> WindForRow:
    return WindForRow.model_validate(
        {
            "publishTime": f"2026-01-14T{published_hour:02d}:30:00Z",
            "startTime": f"2026-01-15T{target_hour:02d}:00:00Z",
            "generation": mw,
        }
    )


def test_normalize_cleans_and_reports_quality() -> None:
    fuel_rows = [
        fuel(1, 1100, published="2026-01-15T00:30:00Z"),
        fuel(1, 1000, published="2026-01-15T12:00:00Z"),  # re-published later: this one wins
        fuel(2, None),  # null generation -> invalid
        fuel(3, 5000, fuel_type="CCGT"),  # other fuels are ignored
        fuel(4, 1200),
    ]
    forecast_rows = [
        forecast(9, 0, 900),
        forecast(9, 0, 950),  # repeated (overlapping fetch windows) -> one value kept
        forecast(11, 0, None),  # invalid
        forecast(13, 1, 980),
    ]
    data = normalize(fuel_rows, forecast_rows, actual_days=WINDOW[0], published=WINDOW[1])

    assert [(a.settlement_period, a.generation_mw) for a in data.actuals] == [
        (1, 1000.0),
        (4, 1200.0),
    ]
    assert [(f.start_time.hour, f.generation_mw) for f in data.forecasts] == [
        (0, 950.0),
        (1, 980.0),
    ]
    q = data.quality
    assert q.actual_periods_expected == 48
    assert q.actual_periods_present == 2
    assert q.missing_actual_periods[0] == utc(2026, 1, 15, 0, 30)
    assert q.invalid_rows_dropped == 2
    assert q.duplicate_rows_dropped == 2
    assert q.forecast_vintages == 2
    assert q.max_vintage_gap_hours == 4.0


def test_snapshot_round_trip_preserves_data(tmp_path: Path) -> None:
    data = normalize(
        [fuel(1, 1000), fuel(2, 1050.5)],
        [forecast(9, 0, 900), forecast(9, 1, 910)],
        actual_days=WINDOW[0],
        published=WINDOW[1],
    )
    window = IngestWindow(actual_days=WINDOW[0], published=WINDOW[1])
    path = tmp_path / "snap.json.gz"
    write_snapshot(
        path,
        data,
        generated_at=utc(2026, 2, 2),
        source="test",
        actual_days=window.actual_days,
        published=window.published,
    )

    loaded = read_snapshot(path)
    direct = to_dataset(data, generated_at=utc(2026, 2, 2), window=window)
    assert loaded.version == direct.version
    assert loaded.actual_count == 2
    assert loaded.info.quality == data.quality
    assert not path.with_name(path.name + ".tmp").exists()  # written atomically

    # Identical data -> identical bytes (reproducible builds, clean diffs).
    first = path.read_bytes()
    write_snapshot(
        path,
        data,
        generated_at=utc(2026, 2, 2),
        source="test",
        actual_days=window.actual_days,
        published=window.published,
    )
    assert path.read_bytes() == first


def test_incompatible_snapshots_are_rejected(tmp_path: Path) -> None:
    path = tmp_path / "old.json.gz"
    path.write_bytes(gzip.compress(json.dumps({"schema_version": 0}).encode()))
    with pytest.raises(SnapshotError, match="schema"):
        read_snapshot(path)
    with pytest.raises(SnapshotError, match="cannot read"):
        read_snapshot(tmp_path / "nope.json.gz")


def test_window_covers_history_and_delivery_days() -> None:
    window = IngestWindow.for_decisions(date(2026, 1, 1), date(2026, 1, 31), history_days=30)
    assert window.actual_days == (date(2025, 12, 3), date(2026, 2, 1))
    assert window.published == (utc(2025, 11, 30), utc(2026, 2, 2))
