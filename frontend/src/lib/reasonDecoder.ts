import { formatMemory } from "../api";
import type { QueueJob } from "../types";

export type ReasonAdvice = {
  reason: string;
  title: string;
  count: number;
  demand: string;
  explanation: string;
  action: string;
  severity: "info" | "warning" | "critical";
};

export function decodePendingReasons(jobs: QueueJob[]): ReasonAdvice[] {
  const groups = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    if (job.state !== "PENDING") continue;
    const reason = job.state_reason || job.reason_label || "Unknown";
    groups.set(reason, [...(groups.get(reason) ?? []), job]);
  }
  return Array.from(groups.entries())
    .map(([reason, rows]) => advice(reason, rows))
    .sort((left, right) => right.count - left.count || severityRank(right) - severityRank(left) || left.reason.localeCompare(right.reason));
}

function advice(reason: string, jobs: QueueJob[]): ReasonAdvice {
  const lower = reason.toLowerCase();
  if (lower.includes("resource")) {
    return row(reason, jobs, "Resource fit", "Requested CPU, memory, GPU, or node shape does not currently fit visible free capacity.", "Try shorter walltime, fewer GPUs, less memory, or a less busy partition.", "warning");
  }
  if (lower.includes("priority")) {
    return row(reason, jobs, "Priority queue", "Resources may exist, but higher-priority work is ahead in the scheduler order.", "Wait for age/fairshare movement, or reduce the request to improve backfill chances.", "info");
  }
  if (lower.includes("dependency")) {
    return row(reason, jobs, "Dependency gate", "These jobs cannot start until another job or condition completes.", "Inspect dependency chains before changing resource requests.", "warning");
  }
  if (lower.includes("qos") || lower.includes("assoc") || lower.includes("limit")) {
    return row(reason, jobs, "Policy cap", "A QOS, association, or account limit is blocking scheduling before placement.", "Check account limits and running allocations for the user or lab.", "critical");
  }
  if (lower.includes("node") || lower.includes("down") || lower.includes("drain")) {
    return row(reason, jobs, "Node availability", "Requested nodes, constraints, or features are unavailable or unhealthy.", "Review constraints and node state before resubmitting.", "critical");
  }
  if (lower.includes("begin") || lower.includes("hold")) {
    return row(reason, jobs, "User timing", "The job is delayed by a requested begin time or hold state.", "Release the hold or adjust begin time if this should run now.", "info");
  }
  return row(reason, jobs, "Scheduler wait", "The scheduler did not expose a more specific public reason in this snapshot.", "Use scontrol show job for constraints, holds, and detailed scheduler fields.", "info");
}

function row(
  reason: string,
  jobs: QueueJob[],
  title: string,
  explanation: string,
  action: string,
  severity: ReasonAdvice["severity"]
): ReasonAdvice {
  return {
    reason,
    title,
    count: jobs.length,
    demand: demandText(jobs),
    explanation,
    action,
    severity
  };
}

function demandText(jobs: QueueJob[]): string {
  const cpus = jobs.reduce((total, job) => total + job.cpus, 0);
  const gpus = jobs.reduce((total, job) => total + job.gpu_count, 0);
  const memory = jobs.reduce((total, job) => total + (job.memory_mb ?? 0), 0);
  return `${cpus} CPU / ${formatMemory(memory)} / ${gpus} GPU`;
}

function severityRank(item: ReasonAdvice): number {
  return item.severity === "critical" ? 2 : item.severity === "warning" ? 1 : 0;
}
