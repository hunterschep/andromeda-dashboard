from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class CacheMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    captured_at: datetime | None = None
    ttl_seconds: int
    is_stale: bool = False
    errors: list[str] = Field(default_factory=list)


class NodeGpuInventory(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = "generic"
    total: int = 0
    used: int = 0
    free: int = 0


class NodeResource(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    state: str
    state_flags: list[str] = Field(default_factory=list)
    partitions: list[str] = Field(default_factory=list)
    features: list[str] = Field(default_factory=list)
    cpus_total: int = 0
    cpus_allocated: int = 0
    cpus_idle: int = 0
    memory_total_mb: int = 0
    memory_free_mb: int | None = None
    gres: list[NodeGpuInventory] = Field(default_factory=list)
    gpu_total: int = 0
    gpu_used: int = 0
    gpu_free: int = 0
    gpu_types: list[str] = Field(default_factory=list)
    reason: str | None = None
    is_available: bool = False


class GpuPool(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    total: int = 0
    used: int = 0
    free: int = 0
    usable: int = 0
    nodes_total: int = 0
    nodes_available: int = 0
    unhealthy_nodes: list[str] = Field(default_factory=list)


class PartitionSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    total_nodes: int = 0
    idle_nodes: int = 0
    mixed_nodes: int = 0
    down_nodes: int = 0
    cpus_total: int = 0
    cpus_idle: int = 0
    memory_free_mb: int = 0
    gpu_total: int = 0
    gpu_free: int = 0
    max_time: str | None = None
    default_time: str | None = None
    qos: list[str] = Field(default_factory=list)
    node_sets: list[str] = Field(default_factory=list)
    configured_tres: dict[str, str] = Field(default_factory=dict)
    node_classes: list[str] = Field(default_factory=list)


class ClusterSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nodes_total: int = 0
    nodes_available: int = 0
    nodes_down: int = 0
    cpus_total: int = 0
    cpus_idle: int = 0
    memory_free_mb: int = 0
    gpu_total: int = 0
    gpu_free: int = 0
    running_jobs: int = 0
    pending_jobs: int = 0


class ResourceResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nodes: list[NodeResource] = Field(default_factory=list)
    gpu_pools: list[GpuPool] = Field(default_factory=list)
    partitions: list[PartitionSummary] = Field(default_factory=list)
    cluster: ClusterSummary = Field(default_factory=ClusterSummary)
    cache: list[CacheMeta] = Field(default_factory=list)


class QueueGpuRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = "generic"
    count: int = 0


class QueueJob(BaseModel):
    model_config = ConfigDict(extra="ignore")

    job_id: str
    name: str | None = None
    user: str
    account: str | None = None
    partition: str | None = None
    state: str
    state_reason: str | None = None
    state_description: str | None = None
    reason_label: str | None = None
    cpus: int = 0
    memory_mb: int | None = None
    gpus: list[QueueGpuRequest] = Field(default_factory=list)
    gpu_count: int = 0
    submit_time: datetime | None = None
    start_time: datetime | None = None
    estimated_start_time: datetime | None = None
    end_time: datetime | None = None
    time_limit_seconds: int | None = None
    elapsed_seconds: int | None = None
    priority: int | None = None
    dependency: str | None = None
    nodes: list[str] = Field(default_factory=list)
    anonymized: bool = False


class QueueResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scope: Literal["mine", "lab", "cluster"]
    jobs: list[QueueJob] = Field(default_factory=list)
    running: int = 0
    pending: int = 0
    cache: list[CacheMeta] = Field(default_factory=list)


class HistoryJob(BaseModel):
    model_config = ConfigDict(extra="ignore")

    job_id: str
    name: str | None = None
    user: str | None = None
    account: str | None = None
    partition: str | None = None
    state: str
    exit_code: str | None = None
    submit_time: datetime | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    wait_seconds: int | None = None
    runtime_seconds: int | None = None
    requested_tres: dict[str, str] = Field(default_factory=dict)
    allocated_tres: dict[str, str] = Field(default_factory=dict)


class HistoryResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    days: int
    jobs: list[HistoryJob] = Field(default_factory=list)
    median_wait_seconds: int | None = None
    median_runtime_seconds: int | None = None
    cache: list[CacheMeta] = Field(default_factory=list)


class QosLimit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    max_jobs_per_user: int | None = None
    max_submit_per_user: int | None = None
    max_tres_per_user: dict[str, str] = Field(default_factory=dict)


class AccountLimits(BaseModel):
    model_config = ConfigDict(extra="ignore")

    user: str | None = None
    account: str | None = None
    qos: list[QosLimit] = Field(default_factory=list)
    raw_rows: list[dict[str, str]] = Field(default_factory=list)


class SchedulerHealth(BaseModel):
    model_config = ConfigDict(extra="ignore")

    last_cycle_seconds: float | None = None
    mean_cycle_seconds: float | None = None
    backfill_last_depth: int | None = None
    backfill_last_cycle_seconds: float | None = None
    queue_depth: int | None = None
    priority_weights: dict[str, float] = Field(default_factory=dict)
    raw: dict[str, str] = Field(default_factory=dict)


class Insight(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    title: str
    severity: Literal["info", "warning", "critical"] = "info"
    confidence: Literal["low", "medium", "high"] = "medium"
    message: str
    details: list[str] = Field(default_factory=list)


class InsightsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    insights: list[Insight] = Field(default_factory=list)
    scheduler: SchedulerHealth | None = None
    account_limits: AccountLimits | None = None
    cache: list[CacheMeta] = Field(default_factory=list)


class ConfigStatus(BaseModel):
    model_config = ConfigDict(extra="ignore")

    config_path: str
    config_exists: bool
    ssh_alias: str
    current_user: str
    host: str
    port: int
    default_scope: str
    lab_users: int
    cache_path: str
    debug: bool


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: Literal["ok"] = "ok"
    version: str = "0.1.0"
    now: datetime = Field(default_factory=utc_now)
