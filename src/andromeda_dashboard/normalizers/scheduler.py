from __future__ import annotations

from ..models import PriorityJob, SchedulerHealth
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


def parse_sprio_jobs(text: str) -> list[PriorityJob]:
    jobs: list[PriorityJob] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if (
            not line
            or line.startswith("-")
            or "Weights" in line
            or line.upper().startswith("JOBID")
        ):
            continue
        parts = _sprio_parts(line)
        if not parts:
            continue
        job_id, values = parts
        factors = {
            "age": values[1],
            "fairshare": values[2],
            "job_size": values[3],
            "partition": values[4],
            "qos": values[5],
            "tres": values[6],
        }
        jobs.append(
            PriorityJob(
                job_id=job_id,
                priority=values[0],
                age=factors["age"],
                fairshare=factors["fairshare"],
                job_size=factors["job_size"],
                partition=factors["partition"],
                qos=factors["qos"],
                tres=factors["tres"],
                dominant_factor=_dominant_factor(factors),
            )
        )
    return jobs


def _sprio_parts(line: str) -> tuple[str, list[float]] | None:
    if "|" in line:
        columns = [part.strip() for part in line.split("|")]
        if len(columns) < 8 or not columns[0]:
            return None
        return columns[0], [_number(part) for part in columns[1:8]]
    columns = line.split()
    if len(columns) >= 8 and parse_float(columns[1]) is not None:
        return columns[0], [_number(part) for part in columns[1:8]]
    if len(columns) >= 11 and parse_float(columns[3]) is not None:
        selected = [columns[index] for index in (3, 5, 6, 7, 8, 9, 10)]
        return columns[0], [_number(part) for part in selected]
    return None


def _number(value: str) -> float:
    return parse_float(value) or 0


def _dominant_factor(factors: dict[str, float]) -> str | None:
    factor, value = max(factors.items(), key=lambda item: (item[1], item[0]))
    return factor if value > 0 else None


def _sdiag_microseconds_to_seconds(value: str | None) -> float | None:
    parsed = parse_float(value)
    if parsed is None:
        return None
    return parsed / 1_000_000
