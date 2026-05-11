from __future__ import annotations

import json
from dataclasses import dataclass

from fastapi.testclient import TestClient

from andromeda_dashboard.api import create_app
from andromeda_dashboard.cache import SQLiteCache
from andromeda_dashboard.collector import (
    ASSOC,
    IDENTITY,
    NODES,
    PARTITIONS,
    QOS,
    QUEUE,
    SCHEDULER,
    SINFO,
    SPRIO,
    SPRIO_JOBS,
    STARTS,
    STORAGE,
    SlurmCollector,
)
from andromeda_dashboard.config import Settings


@dataclass
class FakeResult:
    stdout: str


class FakeRunner:
    def __init__(self, outputs: dict[str, str]):
        self.outputs = outputs

    def run(self, remote_command: str, *, timeout_seconds: int | None = None):
        return FakeResult(stdout=self.outputs[remote_command])


def test_api_contracts(load_json, load_text, tmp_path):
    settings = Settings(
        cache={"path": str(tmp_path / "api.sqlite3")},
        slurm={"user": "hunterschep"},
        lab={"users": ["labmate"]},
    )
    outputs = {
        NODES.command: json.dumps(load_json("nodes.json")),
        IDENTITY.command: "hunterschep",
        PARTITIONS.command: json.dumps(load_json("partitions.json")),
        SINFO.command: json.dumps(load_json("sinfo.json")),
        QUEUE.command: json.dumps(load_json("queue.json")),
        STARTS.command: json.dumps(load_json("starts.json")),
        QOS.command: load_text("qos.txt"),
        ASSOC.command: load_text("assoc.txt"),
        SCHEDULER.command: load_text("sdiag.txt"),
        SPRIO.command: load_text("sprio.txt"),
        SPRIO_JOBS.command: load_text("sprio.txt"),
        STORAGE.command: load_text("storage.txt"),
        "sacct --json -S now-7days -n -X": json.dumps(load_json("history.json")),
    }
    collector = SlurmCollector(
        settings, runner=FakeRunner(outputs), cache=SQLiteCache(settings.cache_path)
    )
    client = TestClient(create_app(settings, collector))

    assert client.get("/api/health").json()["status"] == "ok"
    status = client.get("/api/config/status").json()
    assert status["ssh_alias"] == "andromeda"
    assert status["current_user"] == "hunterschep"

    resources = client.get("/api/resources").json()
    assert set(resources) >= {"nodes", "gpu_pools", "partitions", "cluster", "cache"}
    assert resources["cluster"]["nodes_total"] == 4

    queue = client.get("/api/queue?scope=cluster").json()
    assert queue["scope"] == "cluster"
    assert queue["pending"] == 2
    private = next(job for job in queue["jobs"] if job["job_id"] == "103")
    assert private["anonymized"] is True
    assert private["name"] is None

    mine = client.get("/api/jobs/mine").json()
    assert [job["job_id"] for job in mine["jobs"]] == ["101"]

    history = client.get("/api/history?days=7").json()
    assert history["median_wait_seconds"] == 900

    insights = client.get("/api/insights").json()
    assert insights["insights"]
    assert insights["scheduler"]["backfill_last_depth"] == 120
    assert insights["priority_jobs"][0]["dominant_factor"] == "fairshare"

    snapshot = client.get("/api/snapshot?scope=mine&days=7").json()
    assert set(snapshot) >= {
        "config",
        "resources",
        "queue",
        "my_jobs",
        "history",
        "insights",
        "cache",
    }
    assert snapshot["config"]["current_user"] == "hunterschep"
    assert snapshot["queue"]["scope"] == "mine"
    assert [job["job_id"] for job in snapshot["my_jobs"]["jobs"]] == ["101"]
    assert snapshot["resources"]["cluster"]["nodes_total"] == 4
    assert snapshot["history"]["median_wait_seconds"] == 900
    assert snapshot["cache"]

    telemetry = client.get("/api/telemetry?scope=mine&hours=24").json()
    assert telemetry["summary"]["count"] == 1
    assert telemetry["samples"][0]["pending"] == 0

    prediction = client.get("/api/prediction?scope=mine&hours=24").json()
    assert prediction["confidence"] == "low"
    assert prediction["wait_band"] == "now/backfill"
    assert prediction["wait_range_minutes"] == {"lower": 0, "upper": 15}
    assert prediction["confidence_reasons"][0] == "1 telemetry sample(s) in window"

    storage = client.get("/api/storage").json()
    assert storage["volumes"][1]["name"] == "scratch"
    assert storage["volumes"][1]["severity"] == "critical"
