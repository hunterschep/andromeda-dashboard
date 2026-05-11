import { formatDuration } from "../api";
import type { PartitionSummary, QueueJob } from "../types";

export type WalltimeSignal = {
  jobId: string;
  jobName: string;
  partition: string;
  current: string;
  suggestion: string;
  severity: "info" | "warning" | "critical";
  reason: string;
};

export function buildWalltimeSignals(jobs: QueueJob[], partitions: PartitionSummary[]): WalltimeSignal[] {
  const byPartition = new Map(partitions.map((partition) => [partition.name, partition]));
  return jobs
    .filter((job) => job.state === "PENDING")
    .map((job) => signalForJob(job, byPartition.get(job.partition ?? "")))
    .sort((left, right) => severityRank(right) - severityRank(left) || left.jobId.localeCompare(right.jobId))
    .slice(0, 5);
}

function signalForJob(job: QueueJob, partition: PartitionSummary | undefined): WalltimeSignal {
  const limit = job.time_limit_seconds;
  const partitionMax = parseSlurmTime(partition?.max_time ?? null);
  const partitionDefault = parseSlurmTime(partition?.default_time ?? null);
  if (job.state_reason === "PartitionTimeLimit") {
    return row(job, "critical", "partition limit", "Requested time exceeds the partition maximum.");
  }
  if (!limit) {
    return row(job, "warning", formatDuration(partitionDefault ?? partitionMax), "No explicit walltime is visible; Slurm may use a partition default or maximum.");
  }
  if (partitionMax && limit > partitionMax) {
    return row(job, "critical", formatDuration(partitionMax), `Requested time is above ${job.partition ?? "partition"} maximum.`);
  }
  if (limit >= 24 * 3600) {
    return row(job, "warning", shorter(limit, partitionDefault), "Long walltime can block backfill even when CPUs or GPUs are technically free.");
  }
  if (limit > 6 * 3600 && job.gpu_count > 0) {
    return row(job, "warning", "4h-6h", "GPU jobs with shorter walltime often fit earlier backfill windows.");
  }
  return row(job, "info", formatDuration(limit), "Walltime is already backfill-friendly relative to common short jobs.");
}

function row(job: QueueJob, severity: WalltimeSignal["severity"], suggestion: string, reason: string): WalltimeSignal {
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    partition: job.partition ?? "n/a",
    current: formatDuration(job.time_limit_seconds),
    suggestion,
    severity,
    reason
  };
}

function shorter(limit: number, fallback: number | null): string {
  const target = Math.min(limit / 2, fallback ?? 12 * 3600, 12 * 3600);
  return formatDuration(Math.max(3600, Math.round(target)));
}

function parseSlurmTime(value: string | null): number | null {
  if (!value || value === "UNLIMITED" || value === "Partition_Limit") return null;
  const [dayPart, clock] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const pieces = clock.split(":").map((part) => Number(part));
  if (pieces.some((part) => Number.isNaN(part))) return null;
  const [hours = 0, minutes = 0, seconds = 0] = pieces.length === 3 ? pieces : [0, pieces[0] ?? 0, pieces[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function severityRank(signal: WalltimeSignal): number {
  return { info: 0, warning: 1, critical: 2 }[signal.severity];
}
