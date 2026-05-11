import { formatDuration, shortTime } from "../api";
import type { QueueJob } from "../types";

export type QueueMotionTone = "moving" | "dark" | "gated" | "unknown";

export type QueueMotionItem = {
  jobId: string;
  name: string;
  tone: QueueMotionTone;
  age: string;
  eta: string;
  request: string;
  title: string;
  message: string;
  action: string;
  command: string;
};

export type QueueMotion = {
  pending: number;
  dated: number;
  dark: number;
  gated: number;
  label: string;
  summary: string;
  items: QueueMotionItem[];
};

export function buildQueueMotion(jobs: QueueJob[], alias: string, nowMs = Date.now()): QueueMotion {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const items = pending.map((job) => item(job, alias, nowMs)).sort(compareItems);
  const dated = items.filter((row) => row.tone === "moving").length;
  const gated = items.filter((row) => row.tone === "gated").length;
  const dark = items.filter((row) => row.tone === "dark").length;
  return {
    pending: pending.length,
    dated,
    dark,
    gated,
    label: `${dated}/${pending.length} dated starts`,
    summary: summary(pending.length, dated, dark, gated),
    items
  };
}

function item(job: QueueJob, alias: string, nowMs: number): QueueMotionItem {
  const ageSeconds = secondsSince(job.submit_time, nowMs);
  const etaSeconds = secondsUntil(job.estimated_start_time, nowMs);
  const tone = toneFor(job, etaSeconds, ageSeconds);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone,
    age: ageSeconds === null ? "unknown" : formatDuration(ageSeconds),
    eta: eta(job.estimated_start_time, etaSeconds),
    request: `${job.cpus} CPU / ${job.gpu_count} GPU`,
    title: titleFor(tone),
    message: messageFor(job, tone, ageSeconds, etaSeconds),
    action: actionFor(tone),
    command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}; scontrol show job -dd ${job.job_id} | sed -n "1,120p"'`
  };
}

function toneFor(job: QueueJob, etaSeconds: number | null, ageSeconds: number | null): QueueMotionTone {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  if (job.dependency || /depend|hold|begin/.test(reason)) return "gated";
  if (etaSeconds !== null) return "moving";
  if (ageSeconds !== null && ageSeconds >= 2 * 3600) return "dark";
  return "unknown";
}

function titleFor(tone: QueueMotionTone): string {
  if (tone === "moving") return "Dated start estimate";
  if (tone === "gated") return "Scheduler gate";
  if (tone === "dark") return "No visible movement";
  return "Motion unknown";
}

function messageFor(job: QueueJob, tone: QueueMotionTone, ageSeconds: number | null, etaSeconds: number | null): string {
  const name = job.name ?? job.job_id;
  if (tone === "moving") {
    return etaSeconds !== null && etaSeconds <= 0
      ? `${name} has a start estimate that is due; Slurm may be revising placement.`
      : `${name} has a dated Slurm start estimate, so this is no longer a blind wait.`;
  }
  if (tone === "gated") return `${name} is gated before resources can matter; inspect dependency, hold, or begin-time fields.`;
  if (tone === "dark") return `${name} has waited ${formatDuration(ageSeconds)} without a public start estimate.`;
  return `${name} has no submit age or start estimate in the visible queue snapshot.`;
}

function actionFor(tone: QueueMotionTone): string {
  if (tone === "moving") return "Watch the estimate and avoid reshaping unless it slips repeatedly.";
  if (tone === "gated") return "Resolve the gate before changing CPU, GPU, memory, or partition.";
  if (tone === "dark") return "Use scontrol and sprio to see whether priority, resources, or constraints are hiding the blocker.";
  return "Refresh queue details before making a scheduling decision.";
}

function summary(pending: number, dated: number, dark: number, gated: number): string {
  if (!pending) return "No pending jobs are visible in the current filters.";
  if (dark) return `${dark} pending job${dark === 1 ? "" : "s"} lack dated starts; those are the least emotionally legible waits.`;
  if (gated) return `${gated} pending job${gated === 1 ? "" : "s"} are gated before resources or priority can help.`;
  if (dated) return `${dated}/${pending} pending jobs have dated Slurm starts, which makes the queue easier to plan around.`;
  return "Pending jobs are visible, but Slurm did not expose enough motion detail.";
}

function eta(value: string | null, seconds: number | null): string {
  if (seconds === null) return "no estimate";
  if (seconds <= 0) return "due";
  return shortTime(value);
}

function secondsSince(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.round((nowMs - time) / 1000)) : null;
}

function secondsUntil(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.round((time - nowMs) / 1000) : null;
}

function compareItems(left: QueueMotionItem, right: QueueMotionItem): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: QueueMotionTone): number {
  return { moving: 0, unknown: 1, gated: 2, dark: 3 }[tone];
}
