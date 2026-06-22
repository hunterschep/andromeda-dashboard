from __future__ import annotations

from typing import Literal

from .cache import CachedPayload
from .commands import CommandSpec
from .config import Settings
from .models import ConfigStatus, HistoryResponse, QueueResponse, ResourceResponse
from .normalizers import (
    normalize_cluster_summary,
    normalize_gpu_pools,
    normalize_history,
    normalize_nodes,
    normalize_partitions,
    normalize_queue,
)


def current_user_from_identity(settings: Settings, identity: CachedPayload | None) -> str:
    if settings.slurm.user:
        return settings.slurm.user
    remote_user = str(identity.payload if identity else "").strip().splitlines()[0:1]
    return remote_user[0] if remote_user and remote_user[0] else settings.current_user


def config_status_for_user(settings: Settings, current_user: str) -> ConfigStatus:
    return ConfigStatus(
        config_path=str(settings.config_path),
        config_exists=settings.config_path.exists(),
        ssh_alias=settings.ssh.alias,
        current_user=current_user,
        host=settings.server.host,
        port=settings.server.port,
        default_scope=settings.privacy.default_scope,
        lab_users=len(settings.lab.users),
        cache_path=str(settings.cache_path),
        debug=settings.privacy.debug,
    )


def normalize_queue_response(
    settings: Settings,
    queue_raw: CachedPayload,
    starts_raw: CachedPayload,
    *,
    scope: Literal["mine", "lab", "cluster"],
    current_user: str,
) -> QueueResponse:
    response = normalize_queue(
        queue_raw.payload if isinstance(queue_raw.payload, dict) else {},
        starts_raw.payload if isinstance(starts_raw.payload, dict) else {},
        scope=scope,
        current_user=current_user,
        lab_users=settings.lab.users,
        debug=settings.privacy.debug,
    )
    response.cache = [queue_raw.meta, starts_raw.meta]
    return response


def normalize_resources_response(
    nodes_raw: CachedPayload,
    partitions_raw: CachedPayload,
    sinfo_raw: CachedPayload,
    *,
    cluster_queue: QueueResponse,
) -> ResourceResponse:
    nodes = normalize_nodes(nodes_raw.payload if isinstance(nodes_raw.payload, dict) else {})
    partitions = normalize_partitions(
        partitions_raw.payload if isinstance(partitions_raw.payload, dict) else {}, nodes
    )
    return ResourceResponse(
        nodes=nodes,
        gpu_pools=normalize_gpu_pools(nodes),
        partitions=partitions,
        cluster=normalize_cluster_summary(nodes, cluster_queue),
        cache=[nodes_raw.meta, partitions_raw.meta, sinfo_raw.meta, *cluster_queue.cache],
    )


def history_days(settings: Settings, days: int | None) -> int:
    days = days or settings.history.default_days
    return days if days in {7, 30} else 7


def history_spec(days: int) -> CommandSpec:
    return CommandSpec(
        key=f"history-{days}",
        command=f"sacct --json -S now-{days}days -n -X",
        ttl_seconds=900,
    )


def normalize_history_response(
    settings: Settings,
    history_raw: CachedPayload,
    *,
    days: int,
) -> HistoryResponse:
    response = normalize_history(
        history_raw.payload if isinstance(history_raw.payload, dict) else {},
        days=days,
        debug=settings.privacy.debug,
    )
    response.cache = [history_raw.meta]
    return response
