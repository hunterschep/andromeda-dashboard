from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TYPE_CHECKING, Literal

from .cache import CachedPayload
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
    STARTS,
    CommandSpec,
)
from .insights import build_insights
from .models import CacheMeta, DashboardSnapshot, InsightsResponse
from .normalizers import (
    parse_sacctmgr_assoc,
    parse_sacctmgr_qos,
    parse_sdiag,
    parse_sprio_weights,
)
from .views import (
    config_status_for_user,
    current_user_from_identity,
    history_days,
    history_spec,
    normalize_history_response,
    normalize_queue_response,
    normalize_resources_response,
)

if TYPE_CHECKING:
    from .collector import SlurmCollector


def build_snapshot(
    collector: SlurmCollector,
    *,
    scope: Literal["mine", "lab", "cluster"],
    days: int | None,
) -> DashboardSnapshot:
    settings = collector.settings
    resolved_days = history_days(settings, days)
    resolved_history = history_spec(resolved_days)
    specs = [
        QUEUE,
        STARTS,
        NODES,
        PARTITIONS,
        SINFO,
        resolved_history,
        QOS,
        ASSOC,
        SCHEDULER,
        SPRIO,
    ]
    if not settings.slurm.user:
        specs.append(IDENTITY)

    raw = run_many(collector, specs)
    current_user = current_user_from_identity(settings, raw.get(IDENTITY.key))
    collector._current_user_cache = current_user

    queue = normalize_queue_response(
        settings,
        raw[QUEUE.key],
        raw[STARTS.key],
        scope=scope,
        current_user=current_user,
    )
    my_jobs = queue if scope == "mine" else normalize_queue_response(
        settings,
        raw[QUEUE.key],
        raw[STARTS.key],
        scope="mine",
        current_user=current_user,
    )
    cluster_queue = queue if scope == "cluster" else normalize_queue_response(
        settings,
        raw[QUEUE.key],
        raw[STARTS.key],
        scope="cluster",
        current_user=current_user,
    )
    resources = normalize_resources_response(
        raw[NODES.key],
        raw[PARTITIONS.key],
        raw[SINFO.key],
        cluster_queue=cluster_queue,
    )
    history = normalize_history_response(settings, raw[resolved_history.key], days=resolved_days)
    account_limits = parse_sacctmgr_assoc(str(raw[ASSOC.key].payload or ""))
    account_limits.qos = parse_sacctmgr_qos(str(raw[QOS.key].payload or ""))
    scheduler = parse_sdiag(str(raw[SCHEDULER.key].payload or ""))
    scheduler.priority_weights = parse_sprio_weights(str(raw[SPRIO.key].payload or ""))
    insights = InsightsResponse(
        insights=build_insights(resources, queue, history, account_limits, scheduler),
        scheduler=scheduler,
        account_limits=account_limits,
        priority_jobs=[],
        cache=[
            *resources.cache,
            *queue.cache,
            *history.cache,
            raw[QOS.key].meta,
            raw[ASSOC.key].meta,
            raw[SCHEDULER.key].meta,
            raw[SPRIO.key].meta,
        ],
    )
    snapshot = DashboardSnapshot(
        config=config_status_for_user(settings, current_user),
        resources=resources,
        queue=queue,
        my_jobs=my_jobs,
        history=history,
        insights=insights,
        cache=dedupe_cache(
            [
                *resources.cache,
                *queue.cache,
                *my_jobs.cache,
                *history.cache,
                *insights.cache,
            ]
        ),
    )
    collector.telemetry.record_snapshot(snapshot)
    return snapshot


def run_many(collector: SlurmCollector, specs: list[CommandSpec]) -> dict[str, CachedPayload]:
    unique_specs = {spec.key: spec for spec in specs}
    if len(unique_specs) <= 1:
        return {key: collector._run(spec) for key, spec in unique_specs.items()}

    results: dict[str, CachedPayload] = {}
    with ThreadPoolExecutor(max_workers=min(len(unique_specs), 6)) as executor:
        futures = {executor.submit(collector._run, spec): spec for spec in unique_specs.values()}
        for future in as_completed(futures):
            spec = futures[future]
            results[spec.key] = future.result()
    return results


def dedupe_cache(cache: list[CacheMeta]) -> list[CacheMeta]:
    by_key: dict[str, CacheMeta] = {}
    for meta in cache:
        current = by_key.get(meta.key)
        if current is None or _cache_meta_rank(meta) > _cache_meta_rank(current):
            by_key[meta.key] = meta
    return [by_key[key] for key in sorted(by_key)]


def _cache_meta_rank(meta: CacheMeta) -> tuple[int, float]:
    freshness = 0 if meta.is_stale else 1
    captured_at = meta.captured_at.timestamp() if meta.captured_at else 0.0
    return freshness, captured_at
