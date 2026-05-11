import { formatDuration, formatMemory, shortTime } from "../api";
import type { QueueJob } from "../types";

export type JobAdvisory = {
  jobId: string;
  title: string;
  severity: "info" | "warning" | "critical";
  detail: string;
  command: string;
  commandLabel: string;
  facts: { label: string; value: string }[];
};

export type JobMonitor = {
  running: number;
  pending: number;
  gpuJobs: number;
  checkpointRisk: number;
  advisories: JobAdvisory[];
};

export function buildJobMonitor(jobs: QueueJob[], alias: string): JobMonitor {
  const advisories = jobs.slice().sort(compareJobs).map((job) => adviseJob(job, alias));
  return {
    running: jobs.filter((job) => job.state === "RUNNING").length,
    pending: jobs.filter((job) => job.state === "PENDING").length,
    gpuJobs: jobs.filter((job) => job.gpu_count > 0).length,
    checkpointRisk: advisories.filter((item) => item.title === "Checkpoint pressure").length,
    advisories
  };
}

function adviseJob(job: QueueJob, alias: string): JobAdvisory {
  const ratio = runtimeRatio(job);
  const pendingReason = job.reason_label ?? job.state_reason ?? "Waiting for scheduler decision.";
  if (job.state === "RUNNING" && ratio !== null && ratio >= 0.85) {
    return row(job, alias, "Checkpoint pressure", "critical", `${percent(ratio)}% of walltime is consumed. Confirm checkpoints and output flushes now.`);
  }
  if (job.state === "RUNNING") {
    const noun = job.gpu_count ? "GPU run active" : "Runtime guard";
    const remaining = timeRemaining(job);
    return row(job, alias, noun, "info", remaining ? `${remaining} remaining before the Slurm limit.` : "Running without a parsed time limit.");
  }
  if (job.dependency) {
    return row(job, alias, "Dependency gate", "warning", `Waiting on dependency ${job.dependency}.`);
  }
  if (job.state === "PENDING" && job.estimated_start_time) {
    return row(job, alias, "Scheduler start estimate", "info", `Slurm currently projects ${shortTime(job.estimated_start_time)}.`);
  }
  if (job.state === "PENDING") {
    return row(job, alias, "Resource-bound pending", "warning", pendingReason);
  }
  return row(job, alias, "Job watch", "info", `${job.state} on ${job.partition ?? "n/a"}.`);
}

function row(job: QueueJob, alias: string, title: string, severity: JobAdvisory["severity"], detail: string): JobAdvisory {
  return {
    jobId: job.job_id,
    title,
    severity,
    detail,
    command: diagnosticCommand(job, alias),
    commandLabel: title.includes("pending") || job.state === "PENDING" ? "Copy queue probe" : "Copy run probe",
    facts: [
      { label: "state", value: job.state },
      { label: "partition", value: job.partition ?? "n/a" },
      { label: "request", value: `${job.cpus} CPU / ${formatMemory(job.memory_mb)} / ${job.gpu_count} GPU` },
      { label: job.state === "RUNNING" ? "elapsed" : "estimate", value: job.state === "RUNNING" ? formatDuration(job.elapsed_seconds) : shortTime(job.estimated_start_time) },
      { label: "nodes", value: job.nodes.join(", ") || "pending" }
    ]
  };
}

function diagnosticCommand(job: QueueJob, alias: string): string {
  const detail = `scontrol show job -dd ${job.job_id} | sed -n "1,90p"`;
  if (job.state === "PENDING") return `ssh ${alias} 'squeue -j ${job.job_id} --start; ${detail}'`;
  return `ssh ${alias} 'sacct -j ${job.job_id} --format=JobID,JobName,State,Elapsed,Start,End,ReqTRES,AllocTRES -P; ${detail}'`;
}

function runtimeRatio(job: QueueJob): number | null {
  if (!job.elapsed_seconds || !job.time_limit_seconds) return null;
  return Math.min(1, job.elapsed_seconds / job.time_limit_seconds);
}

function timeRemaining(job: QueueJob): string | null {
  if (!job.elapsed_seconds || !job.time_limit_seconds) return null;
  return formatDuration(Math.max(0, job.time_limit_seconds - job.elapsed_seconds));
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function compareJobs(left: QueueJob, right: QueueJob): number {
  return priority(right) - priority(left) || left.job_id.localeCompare(right.job_id);
}

function priority(job: QueueJob): number {
  return (job.state === "RUNNING" ? 10_000 : 5_000) + job.gpu_count * 500 + (job.elapsed_seconds ?? 0) / 100;
}
