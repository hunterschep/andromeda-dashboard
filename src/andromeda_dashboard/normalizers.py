from __future__ import annotations

import hashlib
import re
import statistics
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, Literal

from .models import (
    AccountLimits,
    ClusterSummary,
    GpuPool,
    HistoryJob,
    HistoryResponse,
    NodeGpuInventory,
    NodeResource,
    PartitionSummary,
    QosLimit,
    QueueGpuRequest,
    QueueJob,
    QueueResponse,
    SchedulerHealth,
)

PENDING_REASON_LABELS: dict[str, str] = {
    "Resources": "Waiting for requested CPUs, memory, GPUs, or nodes to free up",
    "Priority": "Eligible, but jobs with higher Slurm priority are ahead",
    "Dependency": "Blocked by a dependency that has not completed",
    "QOSMaxJobsPerUserLimit": "At the per-user running job limit for this QOS",
    "QOSMaxSubmitJobPerUserLimit": "At the per-user submitted job limit for this QOS",
    "QOSMaxGRESPerUser": "At the per-user GPU limit for this QOS",
    "QOSMaxCpuPerUserLimit": "At the per-user CPU limit for this QOS",
    "AssocGrpGRES": "The account or association GPU limit is currently reached",
    "AssocGrpCpuLimit": "The account or association CPU limit is currently reached",
    "ReqNodeNotAvail": "Requested nodes are unavailable, drained, down, or reserved",
    "PartitionTimeLimit": "Requested wall time exceeds the partition limit",
    "BeginTime": "Job has a future begin time",
}


def as_list(value: Any) -> list[Any]:
    value = unwrap_slurm_value(value)
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple | set):
        return list(value)
    if isinstance(value, str):
        if not value or value in {"(null)", "None", "N/A"}:
            return []
        return [part.strip() for part in re.split(r"[, ]+", value) if part.strip()]
    return [value]


def pick(mapping: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return default


def parse_int(value: Any, default: int = 0) -> int:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    match = re.search(r"-?\d+", str(value).replace(",", ""))
    return int(match.group(0)) if match else default


def parse_float(value: Any) -> float | None:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group(0)) if match else None


def parse_memory_mb(value: Any) -> int | None:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return int(value)
    text = str(value).strip()
    if not text or text in {"0n", "(null)", "N/A"}:
        return None
    match = re.match(r"(?P<num>\d+(?:\.\d+)?)(?P<unit>[KMGTP]?)", text, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group("num"))
    unit = match.group("unit").upper()
    factor = {"": 1, "K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024, "P": 1024**3}[unit]
    return int(number * factor)


def parse_duration_seconds(value: Any) -> int | None:
    if isinstance(value, dict) and "number" in value:
        value = unwrap_slurm_value(value)
        return int(value) * 60 if value is not None else None
    value = unwrap_slurm_value(value)
    if value is None or value == "" or value in {"UNLIMITED", "Partition_Limit", "N/A"}:
        return None
    if isinstance(value, int | float):
        return int(value)
    text = str(value).strip()
    if "-" in text:
        days_text, rest = text.split("-", 1)
        days = parse_int(days_text)
    else:
        days, rest = 0, text
    parts = [parse_int(part) for part in rest.split(":")]
    if len(parts) == 3:
        hours, minutes, seconds = parts
    elif len(parts) == 2:
        hours, minutes, seconds = 0, parts[0], parts[1]
    elif len(parts) == 1:
        hours, minutes, seconds = 0, parts[0], 0
    else:
        return None
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def parse_datetime(value: Any) -> datetime | None:
    value = unwrap_slurm_value(value)
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        return None
    if value is None or value in {"", 0, "0", "Unknown", "N/A", "(null)"}:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, int | float):
        if value <= 0:
            return None
        return datetime.fromtimestamp(float(value), tz=UTC)
    text = str(value).strip()
    if text.isdigit():
        return parse_datetime(int(text))
    try:
        normalized = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def parse_tres(value: Any) -> dict[str, str]:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return {}
    if isinstance(value, dict):
        return {str(key): str(item) for key, item in value.items() if item not in (None, "")}
    result: dict[str, str] = {}
    for token in _split_csvish(str(value)):
        if "=" in token:
            key, item = token.split("=", 1)
        elif ":" in token and token.startswith("gres/"):
            key, item = token.rsplit(":", 1)
        else:
            continue
        result[key.strip()] = item.strip()
    return result


def _split_csvish(text: str) -> list[str]:
    tokens: list[str] = []
    current: list[str] = []
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")" and depth:
            depth -= 1
        if char == "," and depth == 0:
            token = "".join(current).strip()
            if token:
                tokens.append(token)
            current = []
        else:
            current.append(char)
    token = "".join(current).strip()
    if token:
        tokens.append(token)
    return tokens


def _gpu_counts_from_gres(value: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    values = value if isinstance(value, list | tuple | set) else [value]
    for item in values:
        if item is None:
            continue
        if isinstance(item, dict):
            gpu_type = str(pick(item, "type", "name", default="generic")).lower()
            count = parse_int(pick(item, "count", "total", default=0))
            if count:
                counts[gpu_type] = counts.get(gpu_type, 0) + count
            continue
        for raw_token in _split_csvish(str(item)):
            token = re.sub(r"\([^)]*\)", "", raw_token.strip())
            token = token.replace("=", ":")
            token = token.removeprefix("gres/")
            if not token or "gpu" not in token:
                continue
            parts = [part for part in token.split(":") if part]
            if not parts or parts[0] != "gpu":
                continue
            if len(parts) >= 3:
                gpu_type = parts[1].lower()
                count = parse_int(parts[2])
            elif len(parts) == 2:
                if parts[1].isdigit():
                    gpu_type, count = "generic", parse_int(parts[1])
                else:
                    gpu_type, count = parts[1].lower(), 1
            else:
                gpu_type, count = "generic", 1
            if count:
                counts[gpu_type] = counts.get(gpu_type, 0) + count
    return counts


def _gpu_counts_from_tres(value: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key, item in parse_tres(value).items():
        if not key.startswith("gres/gpu"):
            continue
        parts = key.split(":")
        gpu_type = parts[1].lower() if len(parts) > 1 and parts[1] else "generic"
        count = parse_int(item)
        if count:
            counts[gpu_type] = counts.get(gpu_type, 0) + count
    return counts


def parse_gpu_requests(*values: Any) -> list[QueueGpuRequest]:
    counts: dict[str, int] = {}
    for value in values:
        for gpu_type, count in _gpu_counts_from_gres(value).items():
            counts[gpu_type] = max(counts.get(gpu_type, 0), count)
        for gpu_type, count in _gpu_counts_from_tres(value).items():
            counts[gpu_type] = max(counts.get(gpu_type, 0), count)
    return [
        QueueGpuRequest(type=gpu_type, count=count)
        for gpu_type, count in sorted(counts.items())
        if count > 0
    ]


def parse_gpu_inventory(
    gres: Any, gres_used: Any = None, alloc_tres: Any = None
) -> list[NodeGpuInventory]:
    totals = _gpu_counts_from_gres(gres)
    used = _gpu_counts_from_gres(gres_used)
    for gpu_type, count in _gpu_counts_from_tres(alloc_tres).items():
        used[gpu_type] = max(used.get(gpu_type, 0), count)

    generic_used = used.pop("generic", 0)
    if generic_used and totals:
        remaining = generic_used
        for gpu_type in sorted(totals):
            assign = min(max(totals[gpu_type] - used.get(gpu_type, 0), 0), remaining)
            used[gpu_type] = used.get(gpu_type, 0) + assign
            remaining -= assign
            if remaining <= 0:
                break
        if remaining:
            used["generic"] = remaining

    gpu_types = sorted(set(totals) | set(used))
    return [
        NodeGpuInventory(
            type=gpu_type,
            total=totals.get(gpu_type, 0),
            used=min(used.get(gpu_type, 0), totals.get(gpu_type, used.get(gpu_type, 0))),
            free=max(totals.get(gpu_type, 0) - used.get(gpu_type, 0), 0),
        )
        for gpu_type in gpu_types
    ]


def normalize_node_state(value: Any) -> tuple[str, list[str]]:
    value = unwrap_slurm_value(value)
    raw = value
    if isinstance(value, list):
        raw = "+".join(str(item) for item in value)
    if isinstance(value, dict):
        raw = pick(value, "current", "state", default="")
    text = str(raw or "UNKNOWN").upper()
    parts = [part for part in re.split(r"[+~# ]+", text) if part]
    state = parts[0] if parts else "UNKNOWN"
    return state, parts[1:]


def unwrap_slurm_value(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get("infinite") is True:
            return None
        if "number" in value:
            if value.get("set") is False:
                return None
            return value.get("number")
        if "current" in value:
            return value.get("current")
        if "name" in value and len(value) == 1:
            return value.get("name")
    return value


def parse_exit_code(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, dict):
        return_code = parse_int(value.get("return_code"), default=0)
        signal = value.get("signal", {})
        signal_code = parse_int(signal.get("id") if isinstance(signal, dict) else signal, default=0)
        return f"{return_code}:{signal_code}"
    return str(value)


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
        unavailable_flags = {"DOWN", "DRAIN", "DRAINED", "FAIL", "FAILING", "NO_RESPOND", "MAINT"}
        is_available = state in {
            "IDLE",
            "MIXED",
            "ALLOCATED",
        } and not unavailable_flags.intersection({state, *flags})
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


def _node_class(node: NodeResource) -> str:
    memory_gb = round(node.memory_total_mb / 1024) if node.memory_total_mb else 0
    if node.gpu_types:
        return f"{'/'.join(node.gpu_types)} GPU, {node.cpus_total} CPU, {memory_gb}GB"
    return f"CPU, {node.cpus_total} core, {memory_gb}GB"


def normalize_partitions(raw: dict[str, Any], nodes: list[NodeResource]) -> list[PartitionSummary]:
    raw_partitions = raw.get("partitions") or raw.get("partition") or []
    by_name: dict[str, dict[str, Any]] = {}
    for item in raw_partitions:
        if not isinstance(item, dict):
            continue
        name = str(pick(item, "name", "partition", "PartitionName", default="unknown"))
        by_name[name] = item

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
                down_nodes=sum(
                    1
                    for node in partition_nodes
                    if node.state in {"DOWN", "DRAIN", "DRAINED"} or "DRAIN" in node.state_flags
                ),
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


def _scope_allows(
    scope: Literal["mine", "lab", "cluster"], user: str, current_user: str, lab_users: set[str]
) -> bool:
    if scope == "mine":
        return user == current_user
    if scope == "lab":
        return user == current_user or user in lab_users
    return True


def _anonymize_user(user: str) -> str:
    digest = hashlib.sha256(user.encode("utf-8")).hexdigest()[:8]
    return f"user-{digest}"


def _nodes_from_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    text = str(value)
    if text in {"", "(null)", "None", "N/A"}:
        return []
    return [node for node in _split_csvish(text) if node]


def normalize_queue(
    raw: dict[str, Any],
    start_raw: dict[str, Any] | None,
    *,
    scope: Literal["mine", "lab", "cluster"],
    current_user: str,
    lab_users: Iterable[str] = (),
    debug: bool = False,
) -> QueueResponse:
    start_times: dict[str, datetime] = {}
    for item in (start_raw or {}).get("jobs", []):
        if not isinstance(item, dict):
            continue
        job_id = str(pick(item, "job_id", "jobid", "id", default=""))
        start = parse_datetime(pick(item, "start_time", "start", "StartTime", default=None))
        if job_id and start:
            start_times[job_id] = start

    lab_set = set(lab_users)
    jobs: list[QueueJob] = []
    for item in raw.get("jobs", []):
        if not isinstance(item, dict):
            continue
        user = str(pick(item, "user_name", "user", "username", default="unknown"))
        if not _scope_allows(scope, user, current_user, lab_set):
            continue
        anonymized = False
        name = pick(item, "name", "job_name", default=None)
        account = pick(item, "account", "account_name", default=None)
        visible_user = user
        if scope == "cluster" and not debug and user not in {current_user, *lab_set}:
            visible_user = _anonymize_user(user)
            name = None
            account = None
            anonymized = True

        job_id = str(pick(item, "job_id", "jobid", "id", default="unknown"))
        state, _ = normalize_node_state(pick(item, "job_state", "state", default="UNKNOWN"))
        state_reason = pick(item, "state_reason", "reason", default=None)
        reason_key = str(state_reason or "")
        gpus = parse_gpu_requests(
            pick(
                item, "tres_per_node", "tres_per_job", "tres_req_str", "required_tres", default=None
            ),
            pick(item, "req_tres", "ReqTRES", default=None),
            pick(item, "gres", "gres_detail", default=None),
        )
        jobs.append(
            QueueJob(
                job_id=job_id,
                name=str(name) if name is not None else None,
                user=visible_user,
                account=str(account) if account is not None else None,
                partition=str(pick(item, "partition", "partition_name", default="") or "") or None,
                state=state,
                state_reason=str(state_reason) if state_reason is not None else None,
                state_description=pick(item, "state_description", "state_desc", default=None),
                reason_label=PENDING_REASON_LABELS.get(reason_key),
                cpus=parse_int(pick(item, "cpus", "num_cpus", "min_cpus", default=0)),
                memory_mb=parse_memory_mb(
                    pick(
                        item,
                        "minimum_memory_per_node",
                        "memory_per_node",
                        "min_memory",
                        "memory",
                        default=None,
                    )
                ),
                gpus=gpus,
                gpu_count=sum(gpu.count for gpu in gpus),
                submit_time=parse_datetime(pick(item, "submit_time", "submit", default=None)),
                start_time=parse_datetime(pick(item, "start_time", "start", default=None)),
                estimated_start_time=start_times.get(job_id),
                end_time=parse_datetime(pick(item, "end_time", "end", default=None)),
                time_limit_seconds=parse_duration_seconds(
                    pick(item, "time_limit", "time_limit_str", default=None)
                ),
                elapsed_seconds=parse_duration_seconds(
                    pick(item, "time_used", "elapsed_time", default=None)
                ),
                priority=parse_int(pick(item, "priority", default=0), default=0),
                dependency=pick(item, "dependency", "dependencies", default=None),
                nodes=_nodes_from_value(
                    pick(item, "nodes", "nodes_allocated", "nodelist", default=None)
                ),
                anonymized=anonymized,
            )
        )
    running = sum(1 for job in jobs if job.state in {"RUNNING", "COMPLETING"})
    pending = sum(1 for job in jobs if job.state == "PENDING")
    return QueueResponse(scope=scope, jobs=jobs, running=running, pending=pending)


def normalize_history(raw: dict[str, Any], *, days: int, debug: bool = False) -> HistoryResponse:
    jobs: list[HistoryJob] = []
    for item in raw.get("jobs", []):
        if not isinstance(item, dict):
            continue
        job_id = str(pick(item, "job_id", "jobid", "id", default="unknown"))
        time_info = item.get("time") if isinstance(item.get("time"), dict) else {}
        submit_time = parse_datetime(
            pick(item, "submit_time", "submit", default=None) or time_info.get("submission")
        )
        start_time = parse_datetime(
            pick(item, "start_time", "start", default=None) or time_info.get("start")
        )
        end_time = parse_datetime(
            pick(item, "end_time", "end", default=None) or time_info.get("end")
        )
        wait_seconds = (
            int((start_time - submit_time).total_seconds()) if submit_time and start_time else None
        )
        runtime_seconds = (
            int((end_time - start_time).total_seconds())
            if start_time and end_time
            else parse_duration_seconds(
                pick(item, "elapsed", "elapsed_raw", default=None) or time_info.get("elapsed")
            )
        )
        job_name = pick(item, "name", "job_name", default=None)
        if not debug and pick(item, "submit_line", default=None):
            job_name = str(job_name or "job")
        jobs.append(
            HistoryJob(
                job_id=job_id,
                name=str(job_name) if job_name is not None else None,
                user=pick(item, "user", "user_name", default=None),
                account=pick(item, "account", default=None),
                partition=pick(item, "partition", default=None),
                state=normalize_node_state(pick(item, "state", "job_state", default="UNKNOWN"))[0],
                exit_code=parse_exit_code(pick(item, "exit_code", "exitcode", default=None)),
                submit_time=submit_time,
                start_time=start_time,
                end_time=end_time,
                wait_seconds=wait_seconds,
                runtime_seconds=runtime_seconds,
                requested_tres=parse_tres(
                    pick(item, "tres_req_str", "req_tres", "ReqTRES", default=None)
                ),
                allocated_tres=parse_tres(
                    pick(item, "alloc_tres", "tres_alloc_str", "AllocTRES", default=None)
                ),
            )
        )
    waits = [
        job.wait_seconds for job in jobs if job.wait_seconds is not None and job.wait_seconds >= 0
    ]
    runtimes = [
        job.runtime_seconds
        for job in jobs
        if job.runtime_seconds is not None and job.runtime_seconds >= 0
    ]
    return HistoryResponse(
        days=days,
        jobs=jobs,
        median_wait_seconds=int(statistics.median(waits)) if waits else None,
        median_runtime_seconds=int(statistics.median(runtimes)) if runtimes else None,
    )


def parse_sacctmgr_qos(text: str) -> list[QosLimit]:
    limits: list[QosLimit] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("-"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) >= 4:
            name, max_jobs, max_submit, max_tres = parts[:4]
        else:
            columns = re.split(r"\s{2,}", line)
            if not columns or columns[0].lower() == "name":
                continue
            name = columns[0]
            max_jobs = columns[1] if len(columns) > 1 else ""
            max_submit = columns[2] if len(columns) > 2 else ""
            max_tres = columns[3] if len(columns) > 3 else ""
        if name.lower() == "name":
            continue
        limits.append(
            QosLimit(
                name=name,
                max_jobs_per_user=parse_int(max_jobs) if max_jobs else None,
                max_submit_per_user=parse_int(max_submit) if max_submit else None,
                max_tres_per_user=parse_tres(max_tres.replace(",", ",")) if max_tres else {},
            )
        )
    return limits


def parse_sacctmgr_assoc(text: str) -> AccountLimits:
    rows: list[dict[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("cluster|"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) >= 4:
            rows.append(
                {"cluster": parts[0], "account": parts[1], "user": parts[2], "qos": parts[3]}
            )
    user = rows[0]["user"] if rows else None
    account = rows[0]["account"] if rows else None
    return AccountLimits(user=user, account=account, raw_rows=rows)


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
