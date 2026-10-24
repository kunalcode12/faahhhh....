"""Versioned, gzip-compressed JSON snapshot of an ingested dataset.

Why snapshots: the January 2026 data is historical and does not change, so
fetching it from Elexon on every cold start would be slow and would make the
app depend on a third-party API being up. The snapshot is produced by the same
ingestion code (`python -m app.cli ingest`) and loads in well under a second.

Layout (columnar, epoch seconds, to stay small):

    {"schema_version": 1, "generated_at": ..., "source": ..., "window": {...},
     "quality": {...},
     "actuals":   {"columns": [...], "rows": [[...], ...]},
     "forecasts": {"columns": [...], "rows": [[...], ...]}}
"""

from __future__ import annotations

import gzip
import json
import os
from dataclasses import asdict
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from app.domain.dataset import DataQuality, DatasetInfo, WindDataset
from app.domain.models import ActualPoint, ForecastPoint
from app.ingestion.normalize import NormalizedData

SCHEMA_VERSION = 1
ACTUAL_COLUMNS = ["start_time", "publish_time", "settlement_date", "settlement_period", "mw"]
FORECAST_COLUMNS = ["publish_time", "start_time", "mw"]


class SnapshotError(Exception):
    """The snapshot file is missing, unreadable or from an incompatible version."""


def _epoch(ts: datetime) -> int:
    return int(ts.timestamp())


def _from_epoch(value: int) -> datetime:
    return datetime.fromtimestamp(value, tz=UTC)


def _number(value: float) -> int | float:
    return int(value) if float(value).is_integer() else round(value, 3)


def write_snapshot(
    path: Path,
    data: NormalizedData,
    *,
    generated_at: datetime,
    source: str,
    actual_days: tuple[date, date],
    published: tuple[datetime, datetime],
) -> None:
    quality = asdict(data.quality)
    quality["missing_actual_periods"] = [_epoch(t) for t in data.quality.missing_actual_periods]
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at.astimezone(UTC).isoformat(),
        "source": source,
        "window": {
            "actual_days": [actual_days[0].isoformat(), actual_days[1].isoformat()],
            "forecast_published": [_epoch(published[0]), _epoch(published[1])],
        },
        "quality": quality,
        "actuals": {
            "columns": ACTUAL_COLUMNS,
            "rows": [
                [
                    _epoch(a.start_time),
                    _epoch(a.publish_time),
                    a.settlement_date.isoformat(),
                    a.settlement_period,
                    _number(a.generation_mw),
                ]
                for a in data.actuals
            ],
        },
        "forecasts": {
            "columns": FORECAST_COLUMNS,
            "rows": [
                [_epoch(f.publish_time), _epoch(f.start_time), _number(f.generation_mw)]
                for f in data.forecasts
            ],
        },
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    # mtime=0 keeps the bytes identical for identical data (clean diffs, stable hashes).
    with tmp.open("wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
        gz.write(raw)
    os.replace(tmp, path)  # atomic: readers never see a half-written file


def read_snapshot(path: Path) -> WindDataset:
    try:
        with gzip.open(path, "rb") as fh:
            payload = json.loads(fh.read())
    except (OSError, json.JSONDecodeError) as exc:
        raise SnapshotError(f"cannot read snapshot {path}: {exc}") from exc

    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SnapshotError(
            f"snapshot schema {payload.get('schema_version')} != expected {SCHEMA_VERSION}"
        )
    if (
        payload["actuals"]["columns"] != ACTUAL_COLUMNS
        or payload["forecasts"]["columns"] != FORECAST_COLUMNS
    ):
        raise SnapshotError("snapshot columns do not match this version of the app")

    actuals = [
        ActualPoint(
            start_time=_from_epoch(start),
            publish_time=_from_epoch(publish),
            settlement_date=date.fromisoformat(sdate),
            settlement_period=period,
            generation_mw=float(mw),
        )
        for start, publish, sdate, period, mw in payload["actuals"]["rows"]
    ]
    forecasts = [
        ForecastPoint(
            publish_time=_from_epoch(publish),
            start_time=_from_epoch(start),
            generation_mw=float(mw),
        )
        for publish, start, mw in payload["forecasts"]["rows"]
    ]
    q = payload["quality"]
    quality = DataQuality(
        actual_periods_expected=q["actual_periods_expected"],
        actual_periods_present=q["actual_periods_present"],
        missing_actual_periods=tuple(_from_epoch(t) for t in q["missing_actual_periods"]),
        forecast_vintages=q["forecast_vintages"],
        forecast_points=q["forecast_points"],
        max_vintage_gap_hours=q["max_vintage_gap_hours"],
        duplicate_rows_dropped=q["duplicate_rows_dropped"],
        invalid_rows_dropped=q["invalid_rows_dropped"],
    )
    window = payload["window"]
    info = DatasetInfo(
        generated_at=datetime.fromisoformat(payload["generated_at"]),
        source=payload["source"],
        actual_days=(
            date.fromisoformat(window["actual_days"][0]),
            date.fromisoformat(window["actual_days"][1]),
        ),
        forecast_published=(
            _from_epoch(window["forecast_published"][0]),
            _from_epoch(window["forecast_published"][1]),
        ),
        quality=quality,
    )
    return WindDataset(actuals, forecasts, info)
