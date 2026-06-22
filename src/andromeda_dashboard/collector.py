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
    normalize_nodes,
    normalize_partitions,
    parse_sacctmgr_assoc,
    parse_sacctmgr_qos,
    parse_sdiag,
    parse_sprio_jobs,
    parse_sprio_weights,
)
from .snapshot import build_snapshot
from .ssh import ReadOnlySSHRunner, SSHCommandError
from .storage import parse_storage_quota
from .telemetry import TelemetryStore
from .views import (
    config_status_for_user,
    current_user_from_identity,
    history_days,
    history_spec,
    normalize_history_response,
    normalize_queue_response,
    normalize_resources_response,
)


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
        self._current_user_cache: str | None = None

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
        return config_status_for_user(self.settings, self.current_user())

    def current_user(self) -> str:
        if self._current_user_cache is not None:
            return self._current_user_cache
        if self.settings.slurm.user:
            self._current_user_cache = self.settings.slurm.user
            return self._current_user_cache
        self._current_user_cache = current_user_from_identity(self.settings, self._run(IDENTITY))
        return self._current_user_cache

    def get_resources(self, cluster_queue: QueueResponse | None = None) -> ResourceResponse:
        nodes_raw = self._run(NODES)
        partitions_raw = self._run(PARTITIONS)
        sinfo_raw = self._run(SINFO)
        queue = cluster_queue or self.get_queue(scope="cluster")
        return normalize_resources_response(
            nodes_raw,
            partitions_raw,
            sinfo_raw,
            cluster_queue=queue,
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
        return normalize_queue_response(
            self.settings,
            queue_raw,
            starts_raw,
            scope=scope,
            current_user=self.current_user(),
        )

    def get_history(self, days: int | None = None) -> HistoryResponse:
        days = history_days(self.settings, days)
        spec = history_spec(days)
        history_raw = self._run(spec)
        return normalize_history_response(self.settings, history_raw, days=days)

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
        return build_snapshot(self, scope=scope, days=days)

    def get_telemetry(self, scope: Literal["mine", "lab", "cluster"] = "mine", hours: int = 24):
        return self.telemetry.trend(scope=scope, hours=hours)

    def get_prediction(self, scope: Literal["mine", "lab", "cluster"] = "mine", hours: int = 24):
        return self.telemetry.prediction(scope=scope, hours=hours)

    def get_storage(self):
        storage_raw = self._run(STORAGE)
        response = parse_storage_quota(str(storage_raw.payload or ""))
        response.cache = [storage_raw.meta]
        return response
