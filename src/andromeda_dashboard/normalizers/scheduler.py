from __future__ import annotations

from ..models import SchedulerHealth
from .common import parse_float, parse_int


def parse_sdiag(text: str) -> SchedulerHealth:
    raw: dict[str, str] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        raw[key.strip()] = value.strip()
    return SchedulerHealth(
        last_cycle_seconds=_sdiag_microseconds_to_seconds(raw.get("Last cycle")),
        mean_cycle_seconds=_sdiag_microseconds_to_seconds(raw.get("Mean cycle")),
        backfill_last_depth=parse_int(raw.get("bf last depth"), default=0)
        if raw.get("bf last depth")
        else None,
        backfill_last_cycle_seconds=_sdiag_microseconds_to_seconds(raw.get("bf last cycle")),
        queue_depth=parse_int(raw.get("Jobs submitted"), default=0)
        if raw.get("Jobs submitted")
        else None,
        raw=raw,
    )


def parse_sprio_weights(text: str) -> dict[str, float]:
    for line in text.splitlines():
        if "Weights" not in line:
            continue
        values = [parse_float(part) for part in line.split() if part != "Weights"]
        numbers = [value for value in values if value is not None]
        names = ["priority", "site", "age", "fairshare", "jobsize", "partition", "qos", "tres"]
        if len(numbers) < len(names):
            names = names[-len(numbers) :]
        return {name: number for name, number in zip(names, numbers, strict=False)}
    return {}


def _sdiag_microseconds_to_seconds(value: str | None) -> float | None:
    parsed = parse_float(value)
    if parsed is None:
        return None
    return parsed / 1_000_000
