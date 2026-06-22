from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from .models import DashboardSnapshot


@dataclass(frozen=True)
class TelemetrySample:
    captured_at: float
    scope: str
    running: int
    pending: int
    gpu_free: int
    gpu_total: int
    cpus_idle: int
    cpus_total: int
    nodes_available: int
    nodes_total: int


class TelemetryStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS telemetry_samples (
                    captured_at REAL NOT NULL,
                    scope TEXT NOT NULL,
                    running INTEGER NOT NULL,
                    pending INTEGER NOT NULL,
                    gpu_free INTEGER NOT NULL,
                    gpu_total INTEGER NOT NULL,
                    cpus_idle INTEGER NOT NULL,
                    cpus_total INTEGER NOT NULL,
                    nodes_available INTEGER NOT NULL,
                    nodes_total INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_telemetry_scope_time "
                "ON telemetry_samples(scope, captured_at)"
            )
            connection.commit()

    def record_snapshot(self, snapshot: DashboardSnapshot) -> None:
        cluster = snapshot.resources.cluster
        values = (
            time.time(),
            snapshot.queue.scope,
            snapshot.queue.running,
            snapshot.queue.pending,
            cluster.gpu_free,
            cluster.gpu_total,
            cluster.cpus_idle,
            cluster.cpus_total,
            cluster.nodes_available,
            cluster.nodes_total,
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO telemetry_samples (
                    captured_at, scope, running, pending, gpu_free, gpu_total,
                    cpus_idle, cpus_total, nodes_available, nodes_total
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            cutoff = time.time() - 45 * 86400
            connection.execute("DELETE FROM telemetry_samples WHERE captured_at < ?", (cutoff,))
            connection.commit()

    def trend(self, *, scope: str, hours: int = 24) -> dict:
        samples = self.samples(scope=scope, hours=hours)
        return {
            "scope": scope,
            "hours": hours,
            "samples": [sample.__dict__ for sample in samples],
            "summary": summarize_samples(samples),
        }

    def prediction(self, *, scope: str, hours: int = 24) -> dict:
        samples = self.samples(scope=scope, hours=hours)
        return predict_queue(scope=scope, hours=hours, samples=samples)

    def samples(self, *, scope: str, hours: int) -> list[TelemetrySample]:
        cutoff = time.time() - max(1, hours) * 3600
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM telemetry_samples
                WHERE scope = ? AND captured_at >= ?
                ORDER BY captured_at ASC
                """,
                (scope, cutoff),
            ).fetchall()
        return [TelemetrySample(**dict(row)) for row in rows]


def summarize_samples(samples: list[TelemetrySample]) -> dict:
    if not samples:
        return {
            "count": 0,
            "peak_pending": 0,
            "median_pending": 0,
            "lowest_gpu_free": 0,
            "latest_pressure": 0,
            "quietest_hour": None,
        }
    pending = sorted(sample.pending for sample in samples)
    latest = samples[-1]
    pressure = latest.pending / max(latest.pending + latest.running, 1)
    return {
        "count": len(samples),
        "peak_pending": max(sample.pending for sample in samples),
        "median_pending": pending[len(pending) // 2],
        "lowest_gpu_free": min(sample.gpu_free for sample in samples),
        "latest_pressure": round(pressure * 100),
        "quietest_hour": quietest_hour(samples),
    }


def quietest_hour(samples: list[TelemetrySample]) -> int | None:
    by_hour: dict[int, list[int]] = {}
    for sample in samples:
        hour = time.localtime(sample.captured_at).tm_hour
        by_hour.setdefault(hour, []).append(sample.pending)
    if not by_hour:
        return None
    return min(by_hour.items(), key=lambda item: sum(item[1]) / len(item[1]))[0]


def predict_queue(*, scope: str, hours: int, samples: list[TelemetrySample]) -> dict:
    if not samples:
        return prediction_payload(
            scope, hours, "low", "unknown", None, {"lower": None, "upper": None},
            ["no telemetry samples in selected window"], "unknown", 0,
            "Collect telemetry before estimating queue movement.",
        )
    latest = samples[-1]
    slope = pending_slope_per_hour(samples)
    confidence = "high" if len(samples) >= 8 else "medium" if len(samples) >= 3 else "low"
    trend = "falling" if slope < -0.2 else "rising" if slope > 0.2 else "flat"
    clear_minutes = None
    if latest.pending > 0 and slope < -0.05:
        clear_minutes = round((latest.pending / abs(slope)) * 60)
    wait_band = prediction_band(latest.pending, clear_minutes, latest.gpu_free, latest.gpu_total)
    wait_range = prediction_range(
        pending=latest.pending,
        clear_minutes=clear_minutes,
        wait_band=wait_band,
        confidence=confidence,
        trend=trend,
    )
    reasons = prediction_reasons(samples, confidence, slope, clear_minutes)
    recommendation = prediction_recommendation(latest, trend, clear_minutes)
    return prediction_payload(
        scope,
        hours,
        confidence,
        trend,
        clear_minutes,
        wait_range,
        reasons,
        wait_band,
        round(slope, 2),
        recommendation,
    )


def pending_slope_per_hour(samples: list[TelemetrySample]) -> float:
    if len(samples) < 2:
        return 0.0
    first = samples[0]
    latest = samples[-1]
    elapsed_hours = max((latest.captured_at - first.captured_at) / 3600, 1 / 60)
    return (latest.pending - first.pending) / elapsed_hours


def prediction_band(pending: int, clear_minutes: int | None, gpu_free: int, gpu_total: int) -> str:
    if pending == 0:
        return "now/backfill"
    if clear_minutes is not None and clear_minutes <= 30:
        return "<30m"
    if clear_minutes is not None and clear_minutes <= 120:
        return "30m-2h"
    if gpu_total and gpu_free == 0:
        return "GPU blocked"
    if clear_minutes is not None:
        return "2h+"
    return "unknown"


def prediction_range(
    *,
    pending: int,
    clear_minutes: int | None,
    wait_band: str,
    confidence: str,
    trend: str,
) -> dict:
    if pending == 0:
        return {"lower": 0, "upper": 15}
    if clear_minutes is not None:
        spread = {"high": 0.25, "medium": 0.45}.get(confidence, 0.75)
        lower = max(0, round(clear_minutes * (1 - spread)))
        upper = max(lower + 5, round(clear_minutes * (1 + spread)))
        return {"lower": lower, "upper": upper}
    if wait_band == "GPU blocked":
        return {"lower": 120, "upper": None}
    if trend == "rising":
        return {"lower": 60, "upper": None}
    if wait_band == "unknown":
        return {"lower": None, "upper": None}
    return {"lower": 30, "upper": 120}


def prediction_reasons(
    samples: list[TelemetrySample], confidence: str, slope: float, clear_minutes: int | None
) -> list[str]:
    reasons = [f"{len(samples)} telemetry sample(s) in window"]
    reasons.append(
        "pending drain rate produced a clearance estimate"
        if clear_minutes is not None
        else "no sustained drain rate yet"
    )
    reasons.append(
        "range is intentionally wide until more samples arrive"
        if confidence == "low"
        else f"pending trend is {round(slope, 2)} jobs/hour"
    )
    return reasons


def prediction_recommendation(
    latest: TelemetrySample, trend: str, clear_minutes: int | None
) -> str:
    if latest.pending == 0:
        return "Visible queue is clear; short jobs may backfill quickly."
    if clear_minutes is not None:
        return (
            f"Observed pending drain suggests roughly {clear_minutes} minute(s) "
            "to clear this visible queue."
        )
    if trend == "rising":
        return "Queue is growing; reduce walltime or resource width to improve placement odds."
    if latest.gpu_total and latest.gpu_free == 0:
        return (
            "GPU supply is fully allocated; consider a compatible GPU class "
            "or CPU-only fallback."
        )
    return "Not enough movement yet; keep watching telemetry or rely on Slurm start estimates."


def prediction_payload(
    scope: str,
    hours: int,
    confidence: str,
    trend: str,
    clear_minutes: int | None,
    wait_range: dict,
    confidence_reasons: list[str],
    wait_band: str,
    slope: float,
    recommendation: str,
) -> dict:
    return {
        "scope": scope,
        "hours": hours,
        "confidence": confidence,
        "trend": trend,
        "estimated_clear_minutes": clear_minutes,
        "wait_range_minutes": wait_range,
        "confidence_reasons": confidence_reasons,
        "wait_band": wait_band,
        "pending_trend_per_hour": slope,
        "recommendation": recommendation,
    }
