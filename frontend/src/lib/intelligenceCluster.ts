import type { GpuPool, NodeResource, PartitionSummary, QueueJob, SchedulerHealth } from "../types";
import { jobDisplayName, score, toneForScore } from "./intelligenceShared";
import type { ClusterIntelligence, TurnoverEvent } from "./intelligenceTypes";

export function buildClusterIntelligence({
  nodes,
  gpuPools,
  partitions,
  jobs,
  scheduler
}: {
  nodes: NodeResource[];
  gpuPools: GpuPool[];
  partitions: PartitionSummary[];
  jobs: QueueJob[];
  scheduler: SchedulerHealth | null;
}): ClusterIntelligence {
  const pendingJobs = jobs.filter((job) => job.state === "PENDING");
  const runningJobs = jobs.filter((job) => job.state === "RUNNING");
  const pendingGpu = pendingJobs.reduce((sum, job) => sum + job.gpu_count, 0);
  const totalGpu = gpuPools.reduce((sum, pool) => sum + pool.total, 0);
  const freeGpu = gpuPools.reduce((sum, pool) => sum + pool.usable, 0);
  const totalCpu = partitions.reduce((sum, partition) => sum + partition.cpus_total, 0);
  const idleCpu = partitions.reduce((sum, partition) => sum + partition.cpus_idle, 0);
  const downNodes = nodes.filter((node) => !node.is_available).length;
  const gpuPressure = totalGpu ? 1 - freeGpu / totalGpu : 0;
  const cpuPressure = totalCpu ? 1 - idleCpu / totalCpu : 0;
  const queuePressure = pendingJobs.length / Math.max(jobs.length, 1);
  const downPressure = downNodes / Math.max(nodes.length, 1);
  const requestPressure = pendingGpu / Math.max(freeGpu + pendingGpu, 1);
  const pressureScore = score(
    gpuPressure * 34 + cpuPressure * 18 + queuePressure * 26 + downPressure * 12 + requestPressure * 10
  );

  return {
    pressureScore,
    pressureTone: toneForScore(pressureScore),
    headline: clusterHeadline({ totalGpu, freeGpu, pendingGpu, pendingJobs: pendingJobs.length, runningJobs: runningJobs.length, downNodes }),
    detail: clusterDetail({ totalGpu, freeGpu, pendingGpu, pendingJobs: pendingJobs.length, runningJobs: runningJobs.length, scheduler }),
    signals: [
      {
        label: "GPU scarcity",
        value: `${freeGpu}/${totalGpu || 0}`,
        detail: pendingGpu ? `${pendingGpu} GPU requested by pending jobs` : "no visible pending GPU demand",
        tone: toneForScore(score(gpuPressure * 70 + requestPressure * 30))
      },
      {
        label: "Queue pressure",
        value: `${pendingJobs.length}`,
        detail: `${runningJobs.length} running jobs in visible scope`,
        tone: toneForScore(score(queuePressure * 100))
      },
      {
        label: "CPU headroom",
        value: `${idleCpu}/${totalCpu || 0}`,
        detail: `${Math.round((1 - cpuPressure) * 100)}% idle by partition inventory`,
        tone: toneForScore(score(cpuPressure * 100))
      },
      {
        label: "Scheduler",
        value: scheduler?.queue_depth === null || scheduler?.queue_depth === undefined ? "n/a" : `${scheduler.queue_depth}`,
        detail: scheduler?.mean_cycle_seconds ? `${scheduler.mean_cycle_seconds.toFixed(1)}s mean cycle` : "cycle data unavailable",
        tone: toneForScore(score((scheduler?.mean_cycle_seconds ?? 0) * 8))
      }
    ],
    turnover: buildTurnover(runningJobs)
  };
}

function buildTurnover(runningJobs: QueueJob[]): TurnoverEvent[] {
  const now = Date.now();
  return runningJobs
    .map((job) => {
      let endTime = job.end_time;
      if (!endTime && job.time_limit_seconds && job.elapsed_seconds !== null && job.elapsed_seconds !== undefined) {
        endTime = new Date(now + Math.max(0, job.time_limit_seconds - job.elapsed_seconds) * 1000).toISOString();
      }
      return {
        jobId: job.job_id,
        jobName: jobDisplayName(job),
        user: job.user,
        partition: job.partition ?? "n/a",
        endTime,
        gpus: job.gpu_count,
        cpus: job.cpus,
        label: turnoverLabel(endTime)
      };
    })
    .filter((job) => job.endTime)
    .sort((left, right) => new Date(left.endTime ?? 0).getTime() - new Date(right.endTime ?? 0).getTime())
    .slice(0, 6);
}

function clusterHeadline(values: {
  totalGpu: number;
  freeGpu: number;
  pendingGpu: number;
  pendingJobs: number;
  runningJobs: number;
  downNodes: number;
}) {
  if (values.totalGpu > 0 && values.freeGpu === 0) return "GPU fleet is fully allocated";
  if (values.pendingGpu > values.freeGpu) return "GPU demand is outrunning visible supply";
  if (values.pendingJobs > values.runningJobs && values.pendingJobs > 0) return "Queue pressure is building";
  if (values.downNodes > 0) return `${values.downNodes} node${values.downNodes === 1 ? "" : "s"} unavailable`;
  if (values.freeGpu > 0) return "GPU headroom is visible";
  return "Cluster has visible headroom";
}

function clusterDetail(values: {
  totalGpu: number;
  freeGpu: number;
  pendingGpu: number;
  pendingJobs: number;
  runningJobs: number;
  scheduler: SchedulerHealth | null;
}) {
  const gpuText = values.totalGpu ? `${values.freeGpu} of ${values.totalGpu} GPU(s) usable` : "no GPU pool in view";
  const queueText = `${values.runningJobs} running / ${values.pendingJobs} pending`;
  const pendingGpuText = values.pendingGpu ? `${values.pendingGpu} pending GPU request${values.pendingGpu === 1 ? "" : "s"}` : "no pending GPU requests";
  const schedulerText = values.scheduler?.backfill_last_depth ? `backfill depth ${values.scheduler.backfill_last_depth}` : "backfill depth unavailable";
  return `${gpuText}; ${queueText}; ${pendingGpuText}; ${schedulerText}.`;
}

function turnoverLabel(endTime: string | null): string {
  if (!endTime) return "unknown";
  const seconds = Math.max(0, Math.round((new Date(endTime).getTime() - Date.now()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 86400)}d`;
}
