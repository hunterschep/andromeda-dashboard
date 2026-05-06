from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from .cache import CachedPayload, SQLiteCache
from .config import Settings
from .insights import build_insights
from .models import (
    AccountLimits,
    CacheMeta,
    ConfigStatus,
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
    parse_sprio_weights,
)
from .ssh import ReadOnlySSHRunner, SSHCommandError


@dataclass(frozen=True)
class CommandSpec:
    key: str
    command: str
    ttl_seconds: int
    json_output: bool = True


NODES = CommandSpec("nodes", "scontrol show nodes --json", 30)
PARTITIONS = CommandSpec("partitions", "scontrol show partition --json", 3600)
SINFO = CommandSpec("sinfo", "sinfo --json", 30)
IDENTITY = CommandSpec("identity", 'printf "%s" "$USER"', 3600, json_output=False)
QUEUE = CommandSpec("queue", "squeue --json", 30)
STARTS = CommandSpec("queue-starts", "squeue --start --json", 30)
SCHEDULER = CommandSpec("scheduler", "sdiag", 60, json_output=False)
SPRIO = CommandSpec("priority-weights", "sprio -w", 60, json_output=False)
QOS = CommandSpec(
    "qos",
    "sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n",
    3600,
    json_output=False,
)
ASSOC = CommandSpec(
    "assoc",
    'sacctmgr show assoc where user="$USER" format=Cluster,Account,User,QOS -P -n',
    3600,
    json_output=False,
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

    def get_resources(self) -> ResourceResponse:
        nodes_raw = self._run(NODES)
        partitions_raw = self._run(PARTITIONS)
        sinfo_raw = self._run(SINFO)
        nodes = normalize_nodes(nodes_raw.payload if isinstance(nodes_raw.payload, dict) else {})
        partitions = normalize_partitions(
            partitions_raw.payload if isinstance(partitions_raw.payload, dict) else {}, nodes
        )
        queue = self.get_queue(scope="cluster")
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
        qos_raw = self._run(QOS)
        assoc_raw = self._run(ASSOC)
        account_limits = parse_sacctmgr_assoc(str(assoc_raw.payload or ""))
        account_limits.qos = parse_sacctmgr_qos(str(qos_raw.payload or ""))
        return account_limits

    def get_scheduler_health(self):
        scheduler_raw = self._run(SCHEDULER)
        sprio_raw = self._run(SPRIO)
        health = parse_sdiag(str(scheduler_raw.payload or ""))
        health.priority_weights = parse_sprio_weights(str(sprio_raw.payload or ""))
        return health

    def get_insights(self) -> InsightsResponse:
        resources = self.get_resources()
        queue = self.get_queue(scope=self.settings.privacy.default_scope)
        history = self.get_history(days=self.settings.history.default_days)
        account_limits = self.get_account_limits()
        scheduler = self.get_scheduler_health()
        cache: list[CacheMeta] = [
            *resources.cache,
            *queue.cache,
            *history.cache,
        ]
        insights = build_insights(resources, queue, history, account_limits, scheduler)
        return InsightsResponse(
            insights=insights,
            scheduler=scheduler,
            account_limits=account_limits,
            cache=cache,
        )
