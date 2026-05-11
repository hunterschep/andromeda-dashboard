import type { HistoryResponse, QueueJob, SchedulerHealth } from "../types";
import { forecastJobWait, jobDisplayName, maxTone } from "./intelligenceShared";
import type { ForecastBand, GpuScarcity, PartitionIntel, PriorityLensItem, QueueExplanation, QueueForecast } from "./intelligenceTypes";

export function buildQueueForecast(
  pendingJobs: QueueJob[],
  partitions: PartitionIntel[],
  gpuScarcity: GpuScarcity[],
  history: HistoryResponse | null,
  scheduler: SchedulerHealth | null
): QueueForecast {
  const bands: ForecastBand[] = [
    { label: "due now", count: 0, tone: "hot" },
    { label: "< 30m", count: 0, tone: "calm" },
    { label: "30m-2h", count: 0, tone: "busy" },
    { label: "2h-6h", count: 0, tone: "hot" },
    { label: "6h+", count: 0, tone: "critical" },
    { label: "unknown", count: 0, tone: "busy" }
  ];
  let earliestStart: string | null = null;
  let withEstimate = 0;

  for (const job of pendingJobs) {
    const estimate = job.estimated_start_time ? new Date(job.estimated_start_time) : null;
    if (!estimate || Number.isNaN(estimate.getTime())) {
      bands[5].count += 1;
      continue;
    }
    withEstimate += 1;
    if (!earliestStart || estimate.getTime() < new Date(earliestStart).getTime()) {
      earliestStart = job.estimated_start_time;
    }
    incrementBand(bands, Math.max(0, Math.round((estimate.getTime() - Date.now()) / 1000)));
  }

  return {
    pending: pendingJobs.length,
    withEstimate,
    noEstimate: pendingJobs.length - withEstimate,
    earliestStart,
    medianWaitSeconds: history?.median_wait_seconds ?? null,
    bands,
    priorityWeight: dominantPriorityWeight(scheduler),
    priorityLens: buildPriorityLens(pendingJobs),
    explanations: pendingJobs
      .slice()
      .sort((left, right) => right.gpu_count - left.gpu_count || right.cpus - left.cpus || left.job_id.localeCompare(right.job_id))
      .slice(0, 5)
      .map((job) => explainJob(job, partitions, gpuScarcity, history))
  };
}

function buildPriorityLens(pendingJobs: QueueJob[]): PriorityLensItem[] {
  const ranked = pendingJobs
    .filter((job) => job.priority !== null && job.priority !== undefined)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.job_id.localeCompare(right.job_id));
  const maxPriority = Math.max(1, ranked[0]?.priority ?? 1);
  return ranked.slice(0, 5).map((job, index) => {
    const priority = job.priority ?? 0;
    return {
      jobId: job.job_id,
      jobName: jobDisplayName(job),
      user: job.user,
      partition: job.partition ?? "n/a",
      priority,
      rank: index + 1,
      percentile: Math.max(1, Math.round((priority / maxPriority) * 100)),
      detail: priorityDetail(job, index),
      tone: index === 0 ? "calm" : index < 3 ? "busy" : "hot"
    };
  });
}

function priorityDetail(job: QueueJob, index: number): string {
  if (index === 0) return "Highest visible pending priority in this scope.";
  if (job.state_reason === "Priority") return `${index} visible pending job(s) currently rank higher.`;
  if (job.gpu_count > 0) return "GPU request competes inside the visible priority order.";
  return "Priority may improve with age, smaller shape, or different partition pressure.";
}

function dominantPriorityWeight(scheduler: SchedulerHealth | null): string | null {
  const weights = Object.entries(scheduler?.priority_weights ?? {});
  return weights.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function incrementBand(bands: ForecastBand[], seconds: number) {
  if (seconds === 0) bands[0].count += 1;
  else if (seconds < 30 * 60) bands[1].count += 1;
  else if (seconds < 2 * 3600) bands[2].count += 1;
  else if (seconds < 6 * 3600) bands[3].count += 1;
  else bands[4].count += 1;
}

function explainJob(
  job: QueueJob,
  partitions: PartitionIntel[],
  gpuScarcity: GpuScarcity[],
  history: HistoryResponse | null
): QueueExplanation {
  const partition = partitions.find((item) => item.name === job.partition);
  const gpu = job.gpus[0] ? gpuScarcity.find((item) => item.type === job.gpus[0].type) : null;
  const base = explanationBase(job, forecastJobWait(job, partition?.waitBand, history));
  if (job.state_reason === "Dependency") return dependencyExplanation(base);
  if (job.state_reason?.startsWith("QOS")) return qosExplanation(base);
  if (job.state_reason === "Priority") return priorityExplanation(base);
  if (job.gpu_count > 0 && gpu) return gpuExplanation(base, partition, gpu, Boolean(job.estimated_start_time));
  if (partition) return partitionExplanation(base, partition, Boolean(job.estimated_start_time));
  return fallbackExplanation(base);
}

function explanationBase(job: QueueJob, waitBand: string) {
  return {
    jobId: job.job_id,
    jobName: jobDisplayName(job),
    user: job.user,
    partition: job.partition ?? "n/a",
    request: `${job.cpus} CPU / ${job.memory_mb ? Math.round(job.memory_mb / 1024).toLocaleString() : "n/a"} GB / ${job.gpu_count} GPU`,
    reason: job.reason_label ?? job.state_reason ?? "Pending",
    waitBand
  };
}

function dependencyExplanation(base: ReturnType<typeof explanationBase>): QueueExplanation {
  return {
    ...base,
    confidence: "high",
    explanation: "This job is waiting on another job or condition before the scheduler can place it.",
    recommendation: "Inspect the dependency chain before changing CPU, GPU, memory, or walltime.",
    tone: "busy"
  };
}

function qosExplanation(base: ReturnType<typeof explanationBase>): QueueExplanation {
  return {
    ...base,
    confidence: "medium",
    explanation: "The scheduler is likely enforcing a QOS or account cap before resource fit is considered.",
    recommendation: "Check QOS limits and running allocations for this account before resubmitting.",
    tone: "hot"
  };
}

function priorityExplanation(base: ReturnType<typeof explanationBase>): QueueExplanation {
  return {
    ...base,
    confidence: "medium",
    explanation: "Resources may exist, but higher-priority work is ahead in the scheduling order.",
    recommendation: "Shorter walltime and smaller resource asks can improve backfill opportunities.",
    tone: "busy"
  };
}

function gpuExplanation(
  base: ReturnType<typeof explanationBase>,
  partition: PartitionIntel | undefined,
  gpu: GpuScarcity,
  hasEstimate: boolean
): QueueExplanation {
  return {
    ...base,
    confidence: hasEstimate ? "high" : "medium",
    explanation: `${gpu.type} demand is ${gpu.pending} pending against ${gpu.usable} currently usable GPU(s); ${partition?.name ?? "this partition"} is constrained by ${partition?.constrainedBy ?? "visible capacity"}.`,
    recommendation: gpu.usable === 0 ? "Try a compatible GPU class or shorter walltime if the workload can tolerate it." : "Watch turnover and start estimates before cancelling a healthy pending job.",
    tone: maxTone(gpu.tone, partition?.tone ?? "busy")
  };
}

function partitionExplanation(
  base: ReturnType<typeof explanationBase>,
  partition: PartitionIntel,
  hasEstimate: boolean
): QueueExplanation {
  return {
    ...base,
    confidence: hasEstimate ? "high" : "medium",
    explanation: `${partition.name} has ${partition.idleCpu.toLocaleString()} idle CPU and ${partition.pendingCpu.toLocaleString()} CPU requested by pending jobs; the dominant constraint is ${partition.constrainedBy}.`,
    recommendation: "If this is flexible work, compare the same request across partitions with lower pressure.",
    tone: partition.tone
  };
}

function fallbackExplanation(base: ReturnType<typeof explanationBase>): QueueExplanation {
  return {
    ...base,
    confidence: "low",
    explanation: "The job is pending, but the visible snapshot does not include enough placement context.",
    recommendation: "Use scontrol show job for node constraints, dependencies, and detailed scheduler fields.",
    tone: "busy"
  };
}
