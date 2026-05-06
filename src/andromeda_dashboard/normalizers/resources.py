from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ..models import ClusterSummary, GpuPool, NodeResource, PartitionSummary, QueueResponse
from .common import (
    as_list,
    normalize_node_state,
    parse_gpu_inventory,
    parse_int,
    parse_memory_mb,
    parse_tres,
    pick,
)


def normalize_nodes(raw: dict[str, Any]) -> list[NodeResource]:
    raw_nodes = raw.get("nodes") or raw.get("Nodes") or []
    nodes: list[NodeResource] = []
    for item in raw_nodes:
        if not isinstance(item, dict):
            continue
        name = str(pick(item, "name", "node_name", "NodeName", default="unknown"))
        state, flags = normalize_node_state(pick(item, "state", "node_state", default="UNKNOWN"))
        cpus_total = parse_int(pick(item, "cpus", "cpus_total", "cpu_total", "CPUTot", default=0))
        cpus_allocated = parse_int(
            pick(item, "alloc_cpus", "cpus_allocated", "allocated_cpus", "CPUAlloc", default=0)
        )
        cpus_idle = parse_int(
            pick(item, "idle_cpus", "CPULoad", default=cpus_total - cpus_allocated)
        )
        if "idle_cpus" not in item:
            cpus_idle = max(cpus_total - cpus_allocated, 0)
        memory_total_mb = (
            parse_memory_mb(
                pick(item, "real_memory", "memory", "memory_total_mb", "RealMemory", default=0)
            )
            or 0
        )
        memory_free_mb = parse_memory_mb(
            pick(item, "free_memory", "memory_free", "free_mem", "FreeMem", default=None)
        )
        gres = parse_gpu_inventory(
            pick(item, "gres", "generic_resources", "Gres", default=None),
            pick(item, "gres_used", "GresUsed", default=None),
            pick(item, "alloc_tres", "tres_used", "AllocTRES", "TRESUsed", default=None),
        )
        gpu_total = sum(gpu.total for gpu in gres)
        gpu_used = sum(gpu.used for gpu in gres)
        gpu_free = sum(gpu.free for gpu in gres)
        unavailable = {"DOWN", "DRAIN", "DRAINED", "FAIL", "FAILING", "NO_RESPOND", "MAINT"}
        is_available = state in {"IDLE", "MIXED", "ALLOCATED"} and not unavailable.intersection(
            {state, *flags}
        )
        if state == "ALLOCATED" and cpus_idle <= 0 and gpu_free <= 0:
            is_available = False
        nodes.append(
            NodeResource(
                name=name,
                state=state,
                state_flags=flags,
                partitions=[
                    str(part) for part in as_list(pick(item, "partitions", "partition", default=[]))
                ],
                features=[
                    str(feature)
                    for feature in as_list(
                        pick(item, "features", "active_features", "available_features", default=[])
                    )
                ],
                cpus_total=cpus_total,
                cpus_allocated=cpus_allocated,
                cpus_idle=max(cpus_idle, 0),
                memory_total_mb=memory_total_mb,
                memory_free_mb=memory_free_mb,
                gres=gres,
                gpu_total=gpu_total,
                gpu_used=gpu_used,
                gpu_free=gpu_free,
                gpu_types=sorted({gpu.type for gpu in gres}),
                reason=pick(item, "reason", "Reason", default=None),
                is_available=is_available,
            )
        )
    return sorted(nodes, key=lambda node: node.name)


def normalize_gpu_pools(nodes: Iterable[NodeResource]) -> list[GpuPool]:
    pools: dict[str, dict[str, Any]] = {}
    for node in nodes:
        for gpu in node.gres:
            pool = pools.setdefault(
                gpu.type,
                {
                    "type": gpu.type,
                    "total": 0,
                    "used": 0,
                    "free": 0,
                    "usable": 0,
                    "nodes_total": 0,
                    "nodes_available": 0,
                    "unhealthy_nodes": [],
                },
            )
            pool["total"] += gpu.total
            pool["used"] += gpu.used
            pool["free"] += gpu.free
            pool["nodes_total"] += 1
            if node.is_available:
                pool["nodes_available"] += 1
                pool["usable"] += gpu.free
            else:
                pool["unhealthy_nodes"].append(node.name)
    return [GpuPool(**pool) for pool in sorted(pools.values(), key=lambda item: item["type"])]


def normalize_partitions(raw: dict[str, Any], nodes: list[NodeResource]) -> list[PartitionSummary]:
    raw_partitions = raw.get("partitions") or raw.get("partition") or []
    by_name = {
        str(pick(item, "name", "partition", "PartitionName", default="unknown")): item
        for item in raw_partitions
        if isinstance(item, dict)
    }
    partition_names = set(by_name)
    for node in nodes:
        partition_names.update(node.partitions)

    summaries: list[PartitionSummary] = []
    for name in sorted(partition_names):
        partition_nodes = [node for node in nodes if name in node.partitions]
        raw_item = by_name.get(name, {})
        states = [node.state for node in partition_nodes]
        summaries.append(
            PartitionSummary(
                name=name,
                total_nodes=len(partition_nodes),
                idle_nodes=sum(1 for state in states if state == "IDLE"),
                mixed_nodes=sum(1 for state in states if state == "MIXED"),
                down_nodes=sum(1 for node in partition_nodes if _node_down(node)),
                cpus_total=sum(node.cpus_total for node in partition_nodes),
                cpus_idle=sum(node.cpus_idle for node in partition_nodes if node.is_available),
                memory_free_mb=sum(
                    node.memory_free_mb or 0 for node in partition_nodes if node.is_available
                ),
                gpu_total=sum(node.gpu_total for node in partition_nodes),
                gpu_free=sum(node.gpu_free for node in partition_nodes if node.is_available),
                max_time=str(
                    pick(raw_item, "max_time", "max_time_limit", "MaxTime", default="") or ""
                )
                or None,
                default_time=str(
                    pick(raw_item, "default_time", "default_time_limit", "DefaultTime", default="")
                    or ""
                )
                or None,
                qos=[
                    str(qos)
                    for qos in as_list(pick(raw_item, "qos", "allow_qos", "AllowQos", default=[]))
                ],
                node_sets=[
                    str(node_set)
                    for node_set in as_list(
                        pick(raw_item, "nodes", "node_sets", "Nodes", default=[])
                    )
                ],
                configured_tres=parse_tres(
                    pick(raw_item, "tres", "configured_tres", "TRES", default=None)
                ),
                node_classes=sorted({_node_class(node) for node in partition_nodes}),
            )
        )
    return summaries


def normalize_cluster_summary(
    nodes: list[NodeResource], queue: QueueResponse | None = None
) -> ClusterSummary:
    return ClusterSummary(
        nodes_total=len(nodes),
        nodes_available=sum(1 for node in nodes if node.is_available),
        nodes_down=sum(1 for node in nodes if node.state in {"DOWN", "DRAIN", "DRAINED"}),
        cpus_total=sum(node.cpus_total for node in nodes),
        cpus_idle=sum(node.cpus_idle for node in nodes if node.is_available),
        memory_free_mb=sum(node.memory_free_mb or 0 for node in nodes if node.is_available),
        gpu_total=sum(node.gpu_total for node in nodes),
        gpu_free=sum(node.gpu_free for node in nodes if node.is_available),
        running_jobs=queue.running if queue else 0,
        pending_jobs=queue.pending if queue else 0,
    )


def _node_class(node: NodeResource) -> str:
    memory_gb = round(node.memory_total_mb / 1024) if node.memory_total_mb else 0
    if node.gpu_types:
        return f"{'/'.join(node.gpu_types)} GPU, {node.cpus_total} CPU, {memory_gb}GB"
    return f"CPU, {node.cpus_total} core, {memory_gb}GB"


def _node_down(node: NodeResource) -> bool:
    return node.state in {"DOWN", "DRAIN", "DRAINED"} or "DRAIN" in node.state_flags
