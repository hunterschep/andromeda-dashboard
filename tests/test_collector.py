from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

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
    STARTS,
    SlurmCollector,
)
from andromeda_dashboard.config import Settings
from andromeda_dashboard.ssh import SSHAuthError, SSHCommandError, SSHTimeoutError


@dataclass
class FakeResult:
    stdout: str
    stderr: str = ""
    returncode: int = 0
    duration_seconds: float = 0.01


class FakeRunner:
    def __init__(self, outputs: dict[str, str], failures: dict[str, Exception] | None = None):
        self.outputs = outputs
        self.failures = failures or {}
        self.calls: list[str] = []

    def run(self, remote_command: str, *, timeout_seconds: int | None = None):
        self.calls.append(remote_command)
        if remote_command in self.failures:
            raise self.failures[remote_command]
        return FakeResult(stdout=self.outputs[remote_command])


def make_settings(tmp_path):
    return Settings(
        cache={"path": str(tmp_path / "cache.sqlite3")},
        slurm={"user": "hunterschep"},
        lab={"users": ["labmate"]},
    )


def outputs(load_json, load_text):
    return {
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
        "sacct --json -S now-7days -n -X": json.dumps(load_json("history.json")),
    }


def test_collector_resources_and_insights(load_json, load_text, tmp_path):
    settings = make_settings(tmp_path)
    collector = SlurmCollector(
        settings,
        runner=FakeRunner(outputs(load_json, load_text)),
        cache=SQLiteCache(settings.cache_path),
    )

    resources = collector.get_resources()
    assert resources.cluster.nodes_total == 4
    assert resources.cluster.gpu_free == 8
    assert resources.cluster.running_jobs == 1
    assert resources.cache

    insights = collector.get_insights()
    assert any(insight.id == "gpu-availability" for insight in insights.insights)
    assert insights.account_limits is not None
    assert insights.scheduler is not None


def test_stale_cache_fallback_for_timeout(load_json, load_text, tmp_path):
    settings = make_settings(tmp_path)
    cache = SQLiteCache(settings.cache_path)
    first = SlurmCollector(settings, runner=FakeRunner(outputs(load_json, load_text)), cache=cache)
    first.get_queue(scope="cluster")
    with sqlite3.connect(settings.cache_path) as connection:
        connection.execute("UPDATE cache_entries SET expires_at = 0 WHERE key = ?", ("queue",))
        connection.commit()

    failing = SlurmCollector(
        settings,
        runner=FakeRunner(
            outputs(load_json, load_text),
            failures={QUEUE.command: SSHTimeoutError("timeout")},
        ),
        cache=cache,
    )
    queue = failing.get_queue(scope="cluster")
    assert len(queue.jobs) == 3
    assert queue.cache[0].is_stale is True
    assert "timeout" in queue.cache[0].errors[0]


def test_invalid_json_uses_partial_empty_result(load_json, load_text, tmp_path):
    settings = make_settings(tmp_path)
    raw = outputs(load_json, load_text)
    raw[NODES.command] = "not-json"
    collector = SlurmCollector(
        settings, runner=FakeRunner(raw), cache=SQLiteCache(settings.cache_path)
    )

    resources = collector.get_resources()
    assert resources.nodes == []
    assert resources.cache[0].is_stale is True


def test_partial_command_failure_does_not_break_resources(load_json, load_text, tmp_path):
    settings = make_settings(tmp_path)
    collector = SlurmCollector(
        settings,
        runner=FakeRunner(
            outputs(load_json, load_text),
            failures={STARTS.command: SSHCommandError("starts failed")},
        ),
        cache=SQLiteCache(settings.cache_path),
    )

    resources = collector.get_resources()
    assert resources.cluster.nodes_total == 4
    assert any(meta.key == "queue-starts" and meta.is_stale for meta in resources.cache)


def test_auth_failure_is_reported_without_password_fallback(load_json, load_text, tmp_path):
    settings = make_settings(tmp_path)
    collector = SlurmCollector(
        settings,
        runner=FakeRunner(
            outputs(load_json, load_text),
            failures={QUEUE.command: SSHAuthError("Permission denied (publickey).")},
        ),
        cache=SQLiteCache(settings.cache_path),
    )

    queue = collector.get_queue(scope="mine")
    assert queue.jobs == []
    assert queue.cache[0].is_stale is True
    assert "Permission denied" in queue.cache[0].errors[0]


def test_remote_identity_drives_mine_scope(load_json, load_text, tmp_path):
    settings = Settings(
        cache={"path": str(tmp_path / "identity.sqlite3")},
        lab={"users": ["labmate"]},
    )
    raw_outputs = outputs(load_json, load_text)
    raw_outputs[IDENTITY.command] = "labmate"
    collector = SlurmCollector(
        settings,
        runner=FakeRunner(raw_outputs),
        cache=SQLiteCache(settings.cache_path),
    )

    assert collector.config_status().current_user == "labmate"
    queue = collector.get_queue(scope="mine")
    assert [job.job_id for job in queue.jobs] == ["102"]
