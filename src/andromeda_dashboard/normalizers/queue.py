from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from datetime import datetime
from typing import Any, Literal

from ..models import QueueJob, QueueResponse
from .common import (
    normalize_node_state,
    parse_datetime,
    parse_duration_seconds,
    parse_gpu_requests,
    parse_int,
    parse_memory_mb,
    pick,
    split_csvish,
    unwrap_slurm_value,
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


def normalize_queue(
    raw: dict[str, Any],
    start_raw: dict[str, Any] | None,
    *,
    scope: Literal["mine", "lab", "cluster"],
    current_user: str,
    lab_users: Iterable[str] = (),
    debug: bool = False,
) -> QueueResponse:
    start_times = _start_times(start_raw or {})
    lab_set = set(lab_users)
    jobs: list[QueueJob] = []
    for item in raw.get("jobs", []):
        if not isinstance(item, dict):
            continue
        user = str(pick(item, "user_name", "user", "username", default="unknown"))
        if not _scope_allows(scope, user, current_user, lab_set):
            continue
        jobs.append(_queue_job(item, user, scope, current_user, lab_set, start_times, debug))
    running = sum(1 for job in jobs if job.state in {"RUNNING", "COMPLETING"})
    pending = sum(1 for job in jobs if job.state == "PENDING")
    return QueueResponse(scope=scope, jobs=jobs, running=running, pending=pending)


def _queue_job(
    item: dict[str, Any],
    user: str,
    scope: Literal["mine", "lab", "cluster"],
    current_user: str,
    lab_set: set[str],
    start_times: dict[str, datetime],
    debug: bool,
) -> QueueJob:
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
    gpus = parse_gpu_requests(
        pick(item, "tres_per_node", "tres_per_job", "tres_req_str", "required_tres", default=None),
        pick(item, "req_tres", "ReqTRES", default=None),
        pick(item, "gres", "gres_detail", default=None),
    )
    return QueueJob(
        job_id=job_id,
        name=str(name) if name is not None else None,
        user=visible_user,
        account=str(account) if account is not None else None,
        partition=str(pick(item, "partition", "partition_name", default="") or "") or None,
        qos=_scalar_text(pick(item, "qos", "qos_name", "qos_raw", default=None)),
        state=state,
        state_reason=str(state_reason) if state_reason is not None else None,
        state_description=pick(item, "state_description", "state_desc", default=None),
        reason_label=PENDING_REASON_LABELS.get(str(state_reason or "")),
        constraints=_constraint_list(
            pick(item, "features", "features_used", "batch_features", "constraints", "constraint", default=None),
            pick(item, "prefer", "preferred_features", default=None),
        ),
        required_nodes=_nodes_from_value(
            pick(item, "required_nodes", "required_node_list", "req_node_list", "req_nodes", default=None)
        ),
        excluded_nodes=_nodes_from_value(
            pick(item, "excluded_nodes", "excluded_node_list", "exc_node_list", "exc_nodes", default=None)
        ),
        reservation=_scalar_text(pick(item, "reservation", "reservation_name", "resv_name", default=None)),
        licenses=_list_from_value(pick(item, "licenses", "licenses_requested", "licenses_allocated", default=None)),
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
        nodes=_nodes_from_value(pick(item, "nodes", "nodes_allocated", "nodelist", default=None)),
        anonymized=anonymized,
    )


def _start_times(raw: dict[str, Any]) -> dict[str, datetime]:
    start_times: dict[str, datetime] = {}
    for item in raw.get("jobs", []):
        if not isinstance(item, dict):
            continue
        job_id = str(pick(item, "job_id", "jobid", "id", default=""))
        start = parse_datetime(pick(item, "start_time", "start", "StartTime", default=None))
        if job_id and start:
            start_times[job_id] = start
    return start_times


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
    return [node for node in split_csvish(text) if node]


def _scalar_text(value: Any) -> str | None:
    value = unwrap_slurm_value(value)
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        value = pick(value, "name", "value", "id", default=None)
    if value is None:
        return None
    text = str(value).strip()
    return None if text in {"", "(null)", "None", "N/A"} else text


def _list_from_value(value: Any) -> list[str]:
    value = unwrap_slurm_value(value)
    if value is None:
        return []
    if isinstance(value, list | tuple | set):
        values = value
    else:
        values = split_csvish(str(value))
    items: list[str] = []
    for item in values:
        text = _scalar_text(item)
        if text:
            items.append(text)
    return sorted(dict.fromkeys(items))


def _constraint_list(*values: Any) -> list[str]:
    tokens: list[str] = []
    for value in values:
        value = unwrap_slurm_value(value)
        if isinstance(value, dict):
            value = pick(value, "features", "constraint", "name", "value", default=None)
        for item in _list_from_value(value):
            for token in re.split(r"[&|,()\[\]\\s]+", item):
                clean = token.strip().strip("!+'\"")
                if clean and clean not in {"*", "(null)", "None", "N/A"}:
                    tokens.append(clean)
    return sorted(dict.fromkeys(tokens))
