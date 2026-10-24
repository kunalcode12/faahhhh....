"""Operational commands.

python -m app.cli ingest [--out PATH]   fetch from Elexon and write the snapshot
python -m app.cli info [--path PATH]    summarise a snapshot file
"""

from __future__ import annotations

import argparse
import asyncio
import time
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.domain.dataset import WindDataset
from app.ingestion.normalize import NormalizedData
from app.ingestion.pipeline import SOURCE, IngestWindow, client_from_settings, fetch
from app.ingestion.snapshot import read_snapshot, write_snapshot


def _describe(dataset: WindDataset, path: Path) -> None:
    info = dataset.info
    q = info.quality
    size_kb = path.stat().st_size / 1024
    print(f"snapshot      {path} ({size_kb:,.0f} KB)")
    print(f"version       {dataset.version}")
    print(f"generated at  {info.generated_at:%Y-%m-%d %H:%M} UTC")
    print(f"actual days   {info.actual_days[0]} .. {info.actual_days[1]}")
    print(
        f"actuals       {q.actual_periods_present:,}/{q.actual_periods_expected:,} "
        f"settlement periods"
    )
    print(f"forecasts     {q.forecast_points:,} points in {q.forecast_vintages:,} runs")
    print(f"max run gap   {q.max_vintage_gap_hours:.1f} h")
    print(f"dropped       {q.duplicate_rows_dropped} duplicates, {q.invalid_rows_dropped} invalid")
    if q.missing_actual_periods:
        print(f"missing       e.g. {q.missing_actual_periods[0]:%Y-%m-%d %H:%M} UTC")


def _ingest(out: Path | None) -> int:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=False)
    window = IngestWindow.from_settings(settings)
    path = out or settings.snapshot_path

    async def run() -> NormalizedData:
        async with client_from_settings(settings) as client:
            return await fetch(client, window)

    print(f"fetching outturn for {window.actual_days[0]} .. {window.actual_days[1]}")
    print(
        f"fetching forecasts published {window.published[0]:%Y-%m-%d %H:%M} .. "
        f"{window.published[1]:%Y-%m-%d %H:%M} UTC"
    )
    started = time.perf_counter()
    data = asyncio.run(run())
    write_snapshot(
        path,
        data,
        generated_at=datetime.now(UTC),
        source=SOURCE,
        actual_days=window.actual_days,
        published=window.published,
    )
    print(f"done in {time.perf_counter() - started:.1f}s\n")
    _describe(read_snapshot(path), path)  # read back: proves the file round-trips
    return 0


def _info(path: Path | None) -> int:
    target = path or get_settings().snapshot_path
    _describe(read_snapshot(target), target)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("ingest", help="fetch from Elexon and write the snapshot")
    ingest.add_argument("--out", type=Path, help="output path (default: SNAPSHOT_PATH)")
    info = commands.add_parser("info", help="summarise a snapshot")
    info.add_argument("--path", type=Path, help="snapshot path (default: SNAPSHOT_PATH)")

    args = parser.parse_args(argv)
    if args.command == "ingest":
        return _ingest(args.out)
    return _info(args.path)


if __name__ == "__main__":
    raise SystemExit(main())
