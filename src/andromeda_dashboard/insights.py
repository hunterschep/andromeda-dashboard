from __future__ import annotations

from .models import (
    AccountLimits,
    HistoryResponse,
    Insight,
    QueueResponse,
    ResourceResponse,
    SchedulerHealth,
)


def build_insights(
    resources: ResourceResponse,
    queue: QueueResponse,
    history: HistoryResponse | None = None,
    account_limits: AccountLimits | None = None,
    scheduler: SchedulerHealth | None = None,
) -> list[Insight]:
    insights: list[Insight] = []

    stale_keys = [meta.key for meta in [*resources.cache, *queue.cache] if meta.is_stale]
    if stale_keys:
        insights.append(
            Insight(
                id="stale-data",
                title="Some data is stale",
                severity="warning",
                confidence="high",
                message="One or more Slurm commands failed, so cached data is being shown.",
                details=stale_keys,
            )
        )

    free_gpu_pools = [pool for pool in resources.gpu_pools if pool.usable > 0]
    if free_gpu_pools:
        best = sorted(free_gpu_pools, key=lambda pool: pool.usable, reverse=True)[0]
        insights.append(
            Insight(
                id="gpu-availability",
                title="GPU availability",
                severity="info",
                confidence="high",
                message=f"{best.usable} usable {best.type} GPU(s) are visible right now.",
                details=[
                    f"{pool.type}: {pool.usable} usable of {pool.total}"
                    for pool in sorted(free_gpu_pools, key=lambda item: item.type)
                ],
            )
        )
    else:
        insights.append(
            Insight(
                id="gpu-availability",
                title="GPU availability",
                severity="warning",
                confidence="medium",
                message="No currently usable GPUs were found in the live node snapshot.",
            )
        )

    roomy_cpu_nodes = [
        node
        for node in resources.nodes
        if node.is_available
        and node.gpu_total == 0
        and node.cpus_idle >= 44
        and (node.memory_free_mb or node.memory_total_mb) >= 180 * 1024
    ]
    if roomy_cpu_nodes:
        insights.append(
            Insight(
                id="large-cpu-nodes",
                title="Large CPU nodes available",
                severity="info",
                confidence="high",
                message=(
                    f"{len(roomy_cpu_nodes)} idle or partially idle "
                    "44-core/180GB CPU node(s) are available."
                ),
                details=[node.name for node in roomy_cpu_nodes[:8]],
            )
        )

    pending_resources = [
        job for job in queue.jobs if job.state == "PENDING" and job.state_reason == "Resources"
    ]
    if pending_resources:
        insights.append(
            Insight(
                id="resource-pending",
                title="Pending for resources",
                severity="info",
                confidence="medium",
                message=f"{len(pending_resources)} visible job(s) are waiting for resources.",
                details=[
                    f"{job.job_id}: {job.partition or 'unknown partition'}"
                    for job in pending_resources[:6]
                ],
            )
        )

    missing_estimates = [
        job
        for job in queue.jobs
        if job.state == "PENDING"
        and job.state_reason != "Dependency"
        and job.estimated_start_time is None
    ]
    if missing_estimates:
        insights.append(
            Insight(
                id="start-estimates",
                title="Limited start estimates",
                severity="info",
                confidence="low",
                message="Slurm did not provide start estimates for some pending jobs.",
                details=[job.job_id for job in missing_estimates[:8]],
            )
        )

    qos_blocked = [
        job for job in queue.jobs if job.state_reason and job.state_reason.startswith("QOS")
    ]
    if qos_blocked:
        insights.append(
            Insight(
                id="qos-limits",
                title="QOS limit warning",
                severity="warning",
                confidence="medium",
                message=f"{len(qos_blocked)} visible pending job(s) appear blocked by QOS limits.",
                details=[
                    job.reason_label or job.state_reason or job.job_id for job in qos_blocked[:6]
                ],
            )
        )
    elif account_limits and account_limits.qos:
        normal = next((qos for qos in account_limits.qos if qos.name == "normal"), None)
        if normal and normal.max_tres_per_user:
            insights.append(
                Insight(
                    id="account-limits",
                    title="Account limits loaded",
                    severity="info",
                    confidence="high",
                    message="QOS/account limits are visible to this account.",
                    details=[
                        (
                            f"{qos.name}: jobs={qos.max_jobs_per_user or 'n/a'}, "
                            f"tres={qos.max_tres_per_user or 'n/a'}"
                        )
                        for qos in account_limits.qos[:4]
                    ],
                )
            )

    if history and history.median_wait_seconds is not None:
        minutes = max(round(history.median_wait_seconds / 60), 0)
        insights.append(
            Insight(
                id="historical-wait",
                title="Historical wait time",
                severity="info",
                confidence="medium",
                message=(
                    f"Median visible wait time over {history.days} days "
                    f"is about {minutes} minute(s)."
                ),
            )
        )

    if scheduler and scheduler.mean_cycle_seconds and scheduler.mean_cycle_seconds > 10:
        insights.append(
            Insight(
                id="scheduler-cycle",
                title="Scheduler cycle elevated",
                severity="warning",
                confidence="medium",
                message=f"Mean scheduler cycle is {scheduler.mean_cycle_seconds:.1f}s.",
            )
        )

    return insights
