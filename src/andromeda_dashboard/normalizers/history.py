from __future__ import annotations

import statistics
from typing import Any

from ..models import HistoryJob, HistoryResponse
from .common import (
    normalize_node_state,
    parse_datetime,
    parse_duration_seconds,
    parse_exit_code,
    parse_memory_mb,
    parse_tres,
    pick,
)


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
                max_rss_mb=parse_memory_mb(pick(item, "max_rss", "MaxRSS", "maxrss", default=None)),
                total_cpu_seconds=parse_duration_seconds(
                    pick(item, "total_cpu", "TotalCPU", "totalcpu", default=None)
                ),
                requested_tres=parse_tres(
                    pick(item, "tres_req_str", "req_tres", "ReqTRES", default=None)
                ),
                allocated_tres=parse_tres(
                    pick(item, "alloc_tres", "tres_alloc_str", "AllocTRES", default=None)
                ),
                tres_usage_in_ave=parse_tres(
                    pick(
                        item,
                        "tres_usage_in_ave",
                        "TRESUsageInAve",
                        "tresusageinave",
                        default=None,
                    )
                ),
                tres_usage_in_max=parse_tres(
                    pick(
                        item,
                        "tres_usage_in_max",
                        "TRESUsageInMax",
                        "tresusageinmax",
                        default=None,
                    )
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
