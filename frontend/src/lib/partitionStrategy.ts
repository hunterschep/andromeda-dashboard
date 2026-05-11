import { formatMemory } from "../api";
import type { PartitionSummary, QueueJob } from "../types";

export type PartitionStrategy = {
  jobId: string;
  jobName: string;
  current: string;
  recommended: string;
  status: "stay" | "move" | "shrink";
  confidence: "low" | "medium" | "high";
  request: string;
  message: string;
  reason: string;
};

type PartitionScore = {
  partition: string;
  score: number;
  reason: string;
  blocked: boolean;
};

export function buildPartitionStrategies(jobs: QueueJob[], partitions: PartitionSummary[]): PartitionStrategy[] {
  const pending = jobs.filter((job) => job.state === "PENDING");
  return pending
    .map((job) => strategyForJob(job, partitions, pending))
    .sort(compareStrategies)
    .slice(0, 5);
}

function strategyForJob(job: QueueJob, partitions: PartitionSummary[], pending: QueueJob[]): PartitionStrategy {
  const scores = partitions.map((partition) => scorePartition(job, partition, pending)).sort((left, right) => right.score - left.score);
  const current = job.partition ?? "unknown";
  const currentScore = scores.find((score) => score.partition === current);
  const best = scores[0];
  const status = statusFor(best, currentScore, current);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    current,
    recommended: best?.partition ?? current,
    status,
    confidence: confidenceFor(best, currentScore),
    request: `${job.cpus} CPU / ${formatMemory(job.memory_mb)} / ${job.gpu_count} GPU`,
    message: messageFor(status, job, best, currentScore),
    reason: best?.reason ?? "No visible partition metadata."
  };
}

function scorePartition(job: QueueJob, partition: PartitionSummary, pending: QueueJob[]): PartitionScore {
  const blocks = hardBlocks(job, partition);
  if (blocks.length) return { partition: partition.name, score: -1000, reason: blocks[0], blocked: true };
  const pendingHere = pending.filter((item) => item.partition === partition.name);
  const gpuFit = job.gpu_count === 0 ? 1 : Math.min(1, partition.gpu_free / Math.max(job.gpu_count, 1));
  const cpuFit = Math.min(1, partition.cpus_idle / Math.max(job.cpus, 1));
  const memoryFit = job.memory_mb ? Math.min(1, partition.memory_free_mb / job.memory_mb) : 1;
  const pressure = pendingHere.length * 8 + pendingHere.reduce((sum, item) => sum + item.gpu_count, 0) * 10;
  const score = Math.round(40 * gpuFit + 28 * cpuFit + 18 * memoryFit - pressure + (partition.name === job.partition ? 4 : 0));
  return {
    partition: partition.name,
    score,
    reason: reason(job, partition, gpuFit, cpuFit, memoryFit, pendingHere.length),
    blocked: false
  };
}

function hardBlocks(job: QueueJob, partition: PartitionSummary): string[] {
  const maxSeconds = parseSlurmTime(partition.max_time);
  return [
    job.gpu_count > 0 && partition.gpu_total === 0 ? "partition has no GPUs" : null,
    job.gpu_count > partition.gpu_total && partition.gpu_total > 0 ? "GPU request exceeds partition inventory" : null,
    job.cpus > partition.cpus_total ? "CPU request exceeds partition inventory" : null,
    maxSeconds && job.time_limit_seconds && job.time_limit_seconds > maxSeconds ? "walltime exceeds partition limit" : null
  ].filter(Boolean) as string[];
}

function reason(job: QueueJob, partition: PartitionSummary, gpuFit: number, cpuFit: number, memoryFit: number, pending: number): string {
  if (job.gpu_count > 0 && gpuFit < 1) return `${partition.gpu_free}/${partition.gpu_total} GPU free now.`;
  if (cpuFit < 1) return `${partition.cpus_idle} idle CPU for ${job.cpus} requested.`;
  if (memoryFit < 1) return `${formatMemory(partition.memory_free_mb)} free memory for ${formatMemory(job.memory_mb)} requested.`;
  if (pending > 0) return `${pending} pending job(s) already target this partition.`;
  return "shape fits visible idle CPU, memory, GPU, and walltime.";
}

function statusFor(best: PartitionScore | undefined, current: PartitionScore | undefined, currentName: string): PartitionStrategy["status"] {
  if (!best || best.blocked) return "shrink";
  if (best.partition !== currentName && (!current || best.score > current.score + 12)) return "move";
  return "stay";
}

function messageFor(status: PartitionStrategy["status"], job: QueueJob, best: PartitionScore | undefined, current: PartitionScore | undefined): string {
  if (status === "shrink") return "No visible partition cleanly fits this shape; shrink GPU/CPU/memory or walltime before resubmitting.";
  if (status === "move") return `${best?.partition ?? "another partition"} looks cleaner than ${job.partition ?? "the current partition"} for this request.`;
  if (current?.blocked) return "Current partition is blocked by policy or inventory, but no better visible target was found.";
  return `Current partition looks plausible for ${job.name ?? job.job_id}; queue order or turnover is likely the larger issue.`;
}

function confidenceFor(best: PartitionScore | undefined, current: PartitionScore | undefined): PartitionStrategy["confidence"] {
  if (!best || !current) return "low";
  if (best.blocked || current.blocked) return "medium";
  return Math.abs(best.score - current.score) > 20 ? "high" : "medium";
}

function compareStrategies(left: PartitionStrategy, right: PartitionStrategy): number {
  return statusRank(right.status) - statusRank(left.status) || left.jobId.localeCompare(right.jobId);
}

function statusRank(status: PartitionStrategy["status"]): number {
  return { stay: 0, move: 1, shrink: 2 }[status];
}

function parseSlurmTime(value: string | null): number | null {
  if (!value || value === "UNLIMITED" || value === "Partition_Limit") return null;
  const [dayPart, clock] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const parts = clock.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}
