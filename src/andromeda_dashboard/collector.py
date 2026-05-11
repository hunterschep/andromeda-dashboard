from __future__ import annotations

import json
from typing import Any, Literal

from .cache import CachedPayload, SQLiteCache
from .commands import (
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
    CommandSpec,
)
from .config import Settings
from .insights import build_insights
from .models import (
    AccountLimits,
    CacheMeta,
    ConfigStatus,
    DashboardSnapshot,
    HistoryResponse,
    InsightsResponse,
    QueueResponse,
    ResourceResponse,
)
from .normalizers import (
    normalize_cluster_summary,
    normalize_gpu_pools,
    normalize_history,
    normalize_nodes,
    normalize_partitions,
    normalize_queue,
    parse_sacctmgr_assoc,
    parse_sacctmgr_qos,
    parse_sdiag,
    parse_sprio_jobs,
    parse_sprio_weights,
)
from .ssh import ReadOnlySSHRunner, SSHCommandError
from .storage import parse_storage_quota
from .telemetry import TelemetryStore


class SlurmCollector:
    def __init__(
        self,
        settings: Settings,
        *,
        runner: ReadOnlySSHRunner | None = None,
        cache: SQLiteCache | None = None,
    ):
        self.settings = settings
        self.runner = runner or ReadOnlySSHRunner(settings.ssh)
        self.cache = cache or SQLiteCache(settings.cache_path)
        self.telemetry = TelemetryStore(settings.cache_path)

    def _result_from_cache_error(
        self, spec: CommandSpec, cached: CachedPayload | None, error: Exception
    ) -> CachedPayload:
        message = str(error)
        if cached:
            return CachedPayload(
                key=cached.key,
                payload=cached.payload,
                captured_at=cached.captured_at,
                ttl_seconds=cached.ttl_seconds,
                is_stale=True,
                errors=[message],
            )
        empty_payload: Any = {} if spec.json_output else ""
        return CachedPayload(
            key=spec.key,
            payload=empty_payload,
            captured_at=None,
            ttl_seconds=spec.ttl_seconds,
            is_stale=True,
            errors=[message],
        )

    def _run(self, spec: CommandSpec) -> CachedPayload:
        fresh = self.cache.get(spec.key, spec.ttl_seconds, include_stale=False)
        if fresh:
            return fresh
        stale = self.cache.get(spec.key, spec.ttl_seconds, include_stale=True)
        try:
            result = self.runner.run(
                spec.command, timeout_seconds=self.settings.ssh.command_timeout_seconds
            )
            payload = json.loads(result.stdout) if spec.json_output else result.stdout
            return self.cache.set(spec.key, payload, spec.ttl_seconds)
        except (json.JSONDecodeError, SSHCommandError) as exc:
            return self._result_from_cache_error(spec, stale, exc)

    def config_status(self) -> ConfigStatus:
        return ConfigStatus(
            config_path=str(self.settings.config_path),
            config_exists=self.settings.config_path.exists(),
            ssh_alias=self.settings.ssh.alias,
            current_user=self.current_user(),
            host=self.settings.server.host,
            port=self.settings.server.port,
            default_scope=self.settings.privacy.default_scope,
            lab_users=len(self.settings.lab.users),
            cache_path=str(self.settings.cache_path),
            debug=self.settings.privacy.debug,
        )

    def current_user(self) -> str:
        if self.settings.slurm.user:
            return self.settings.slurm.user
        identity = self._run(IDENTITY)
        remote_user = str(identity.payload or "").strip().splitlines()[0:1]
        return remote_user[0] if remote_user and remote_user[0] else self.settings.current_user

    def get_resources(self, cluster_queue: QueueResponse | None = None) -> ResourceResponse:
        nodes_raw = self._run(NODES)
        partitions_raw = self._run(PARTITIONS)
        sinfo_raw = self._run(SINFO)
        nodes = normalize_nodes(nodes_raw.payload if isinstance(nodes_raw.payload, dict) else {})
        partitions = normalize_partitions(
            partitions_raw.payload if isinstance(partitions_raw.payload, dict) else {}, nodes
        )
        queue = cluster_queue or self.get_queue(scope="cluster")
        return ResourceResponse(
            nodes=nodes,
            gpu_pools=normalize_gpu_pools(nodes),
            partitions=partitions,
            cluster=normalize_cluster_summary(nodes, queue),
            cache=[nodes_raw.meta, partitions_raw.meta, sinfo_raw.meta, *queue.cache],
        )

    def get_partitions(self) -> list:
        nodes_raw = self._run(NODES)
        partitions_raw = self._run(PARTITIONS)
        nodes = normalize_nodes(nodes_raw.payload if isinstance(nodes_raw.payload, dict) else {})
        return normalize_partitions(
            partitions_raw.payload if isinstance(partitions_raw.payload, dict) else {}, nodes
        )

    def get_queue(self, scope: Literal["mine", "lab", "cluster"] = "mine") -> QueueResponse:
        queue_raw = self._run(QUEUE)
        starts_raw = self._run(STARTS)
        response = normalize_queue(
            queue_raw.payload if isinstance(queue_raw.payload, dict) else {},
            starts_raw.payload if isinstance(starts_raw.payload, dict) else {},
            scope=scope,
            current_user=self.current_user(),
            lab_users=self.settings.lab.users,
            debug=self.settings.privacy.debug,
        )
        response.cache = [queue_raw.meta, starts_raw.meta]
        return response

    def get_history(self, days: int | None = None) -> HistoryResponse:
        days = days or self.settings.history.default_days
        if days not in {7, 30}:
            days = 7
        spec = CommandSpec(
            key=f"history-{days}",
            command=f"sacct --json -S now-{days}days -n -X",
            ttl_seconds=900,
        )
        history_raw = self._run(spec)
        response = normalize_history(
            history_raw.payload if isinstance(history_raw.payload, dict) else {},
            days=days,
            debug=self.settings.privacy.debug,
        )
        response.cache = [history_raw.meta]
        return response

    def get_account_limits(self) -> AccountLimits:
        account_limits, _cache = self._get_account_limits_with_cache()
        return account_limits

    def _get_account_limits_with_cache(self) -> tuple[AccountLimits, list[CacheMeta]]:
        qos_raw = self._run(QOS)
        assoc_raw = self._run(ASSOC)
        account_limits = parse_sacctmgr_assoc(str(assoc_raw.payload or ""))
        account_limits.qos = parse_sacctmgr_qos(str(qos_raw.payload or ""))
        return account_limits, [qos_raw.meta, assoc_raw.meta]

    def get_scheduler_health(self):
        scheduler, _cache = self._get_scheduler_health_with_cache()
        return scheduler

    def _get_scheduler_health_with_cache(self):
        scheduler_raw = self._run(SCHEDULER)
        sprio_raw = self._run(SPRIO)
        health = parse_sdiag(str(scheduler_raw.payload or ""))
        health.priority_weights = parse_sprio_weights(str(sprio_raw.payload or ""))
        return health, [scheduler_raw.meta, sprio_raw.meta]

    def _get_priority_jobs_with_cache(self):
        priority_raw = self._run(SPRIO_JOBS)
        jobs = parse_sprio_jobs(str(priority_raw.payload or ""))
        return jobs, [priority_raw.meta]

    def get_insights(
        self,
        *,
        resources: ResourceResponse | None = None,
        queue: QueueResponse | None = None,
        history: HistoryResponse | None = None,
    ) -> InsightsResponse:
        resources = resources or self.get_resources()
        queue = queue or self.get_queue(scope=self.settings.privacy.default_scope)
        history = history or self.get_history(days=self.settings.history.default_days)
        account_limits, account_cache = self._get_account_limits_with_cache()
        scheduler, scheduler_cache = self._get_scheduler_health_with_cache()
        priority_jobs, priority_cache = self._get_priority_jobs_with_cache()
        cache: list[CacheMeta] = [
            *resources.cache,
            *queue.cache,
            *history.cache,
            *account_cache,
            *scheduler_cache,
            *priority_cache,
        ]
        insights = build_insights(resources, queue, history, account_limits, scheduler)
        return InsightsResponse(
            insights=insights,
            scheduler=scheduler,
            account_limits=account_limits,
            priority_jobs=priority_jobs,
            cache=cache,
        )

    def get_snapshot(
        self,
        scope: Literal["mine", "lab", "cluster"] = "mine",
        days: int | None = None,
    ) -> DashboardSnapshot:
        config = self.config_status()
        queue = self.get_queue(scope=scope)
        my_jobs = queue if scope == "mine" else self.get_queue(scope="mine")
        cluster_queue = queue if scope == "cluster" else self.get_queue(scope="cluster")
        resources = self.get_resources(cluster_queue=cluster_queue)
        history = self.get_history(days=days)
        insights = self.get_insights(resources=resources, queue=queue, history=history)
        cache = self._dedupe_cache(
            [
                *resources.cache,
                *queue.cache,
                *my_jobs.cache,
                *history.cache,
                *insights.cache,
            ]
        )
        snapshot = DashboardSnapshot(
            config=config,
            resources=resources,
            queue=queue,
            my_jobs=my_jobs,
            history=history,
            insights=insights,
            cache=cache,
        )
        self.telemetry.record_snapshot(snapshot)
        return snapshot

    def get_telemetry(self, scope: Literal["mine", "lab", "cluster"] = "mine", hours: int = 24):
        return self.telemetry.trend(scope=scope, hours=hours)

    def get_prediction(self, scope: Literal["mine", "lab", "cluster"] = "mine", hours: int = 24):
        return self.telemetry.prediction(scope=scope, hours=hours)

    def get_storage(self):
        storage_raw = self._run(STORAGE)
        response = parse_storage_quota(str(storage_raw.payload or ""))
        response.cache = [storage_raw.meta]
        return response

    @staticmethod
    def _dedupe_cache(cache: list[CacheMeta]) -> list[CacheMeta]:
        by_key = {meta.key: meta for meta in cache}
        return [by_key[key] for key in sorted(by_key)]
