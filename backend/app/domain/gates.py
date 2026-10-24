"""GB day-ahead auctions the desk can bid into (all times UK local, on D-1)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time


@dataclass(frozen=True, slots=True)
class GatePreset:
    id: str
    label: str
    venue: str
    product: str
    gate: time
    results: str
    description: str


GATE_PRESETS: tuple[GatePreset, ...] = (
    GatePreset(
        id="epex-60",
        label="EPEX 60-min",
        venue="EPEX SPOT",
        product="Hourly",
        gate=time(9, 20),
        results="from 09:30",
        description="GB day-ahead hourly auction",
    ),
    GatePreset(
        id="n2ex",
        label="N2EX",
        venue="Nord Pool",
        product="Hourly",
        gate=time(9, 50),
        results="by 10:00",
        description="GB day-ahead auction (the long-standing GB reference price)",
    ),
    GatePreset(
        id="epex-30",
        label="EPEX 30-min",
        venue="EPEX SPOT",
        product="Half-hourly",
        gate=time(15, 30),
        results="from 15:45",
        description="GB day-ahead half-hourly auction",
    ),
)

DEFAULT_GATE = time(9, 50)
