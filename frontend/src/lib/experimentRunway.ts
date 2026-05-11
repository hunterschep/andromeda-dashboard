import { formatDuration, shortTime } from "../api";
import type { QueueJob } from "../types";

export type RunwayTone = "clear" | "watch" | "urgent" | "unknown";

export type RunwayJob = {
  jobId: string;
  name: string;
  state: string;
  tone: RunwayTone;
  progress: number | null;
  wait: string;
  elapsed: string;
  remaining: string;
  deadline: string;
  node: string;
  headline: string;
  action: string;
};

export type ExperimentRunway = {
  total: number;
  urgent: number;
  watch: number;
  unknown: number;
  label: string;
  jobs: RunwayJob[];
};

export function buildExperimentRunway(jobs: QueueJob[], nowMs = Date.now()): ExperimentRunway {
  const rows = jobs.map((job) => row(job, nowMs)).sort(compareRows);
  const urgent = rows.filter((job) => job.tone === "urgent").length;
  const watch = rows.filter((job) => job.tone === "watch").length;
  const unknown = rows.filter((job) => job.tone === "unknown").length;
  return {
    total: rows.length,
    urgent,
    watch,
    unknown,
    label: labelFor(urgent, watch, unknown),
    jobs: rows
  };
}

function row(job: QueueJob, nowMs: number): RunwayJob {
  const progress = progressPercent(job);
  const remainingSeconds = remaining(job);
  const waitSeconds = waitAge(job, nowMs);
  const tone = toneFor(job, progress, remainingSeconds);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    state: job.state,
    tone,
    progress,
    wait: waitSeconds === null ? "n/a" : formatDuration(waitSeconds),
    elapsed: formatDuration(job.elapsed_seconds),
    remaining: remainingSeconds === null ? "unknown" : formatDuration(remainingSeconds),
    deadline: deadline(job, remainingSeconds),
    node: job.nodes[0] ?? "pending",
    headline: headline(job, tone, remainingSeconds, progress),
    action: action(job, tone)
  };
}

function toneFor(job: QueueJob, progress: number | null, remainingSeconds: number | null): RunwayTone {
  if (job.state === "PENDING" && !job.estimated_start_time) return job.dependency ? "watch" : "unknown";
  if (progress === null || remainingSeconds === null) return job.state === "RUNNING" ? "unknown" : "clear";
  if (progress >= 90 || remainingSeconds <= 3600) return "urgent";
  if (progress >= 75 || remainingSeconds <= 4 * 3600) return "watch";
  return "clear";
}

function headline(job: QueueJob, tone: RunwayTone, remainingSeconds: number | null, progress: number | null): string {
  if (job.state === "PENDING" && job.estimated_start_time) return `Start estimate ${shortTime(job.estimated_start_time)}`;
  if (job.state === "PENDING" && job.dependency) return "Waiting on workflow dependency";
  if (tone === "urgent") return `${progress ?? 0}% walltime burned; ${formatDuration(remainingSeconds)} left`;
  if (tone === "watch") return `${formatDuration(remainingSeconds)} left before Slurm deadline`;
  if (tone === "unknown") return "Timing data is incomplete";
  return "Runway is visible and stable";
}

function action(job: QueueJob, tone: RunwayTone): string {
  if (job.state === "PENDING" && job.dependency) return "Track upstream completion before changing the submission.";
  if (job.state === "PENDING" && job.estimated_start_time) return "Avoid churn unless the estimate slips or dependencies change.";
  if (tone === "urgent") return "Verify checkpoint, output path, and stderr before the final window closes.";
  if (tone === "watch") return "Confirm checkpoint cadence while there is still time to react.";
  if (tone === "unknown") return "Inspect scontrol for submit, start, timelimit, and end fields.";
  return "Keep normal log and utilization monitoring active.";
}

function labelFor(urgent: number, watch: number, unknown: number): string {
  if (urgent) return `${urgent} urgent runway${urgent === 1 ? "" : "s"}`;
  if (watch) return `${watch} watch window${watch === 1 ? "" : "s"}`;
  if (unknown) return `${unknown} incomplete timeline${unknown === 1 ? "" : "s"}`;
  return "runways clear";
}

function progressPercent(job: QueueJob): number | null {
  if (job.elapsed_seconds === null || job.elapsed_seconds === undefined || !job.time_limit_seconds) return null;
  return Math.min(100, Math.round((job.elapsed_seconds / job.time_limit_seconds) * 100));
}

function remaining(job: QueueJob): number | null {
  if (job.elapsed_seconds === null || job.elapsed_seconds === undefined || !job.time_limit_seconds) return null;
  return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
}

function waitAge(job: QueueJob, nowMs: number): number | null {
  if (!job.submit_time) return null;
  const start = job.start_time ? new Date(job.start_time).getTime() : Number.NaN;
  const end = Number.isFinite(start) ? start : job.state === "PENDING" ? nowMs : Number.NaN;
  const submit = new Date(job.submit_time).getTime();
  if (!Number.isFinite(submit) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - submit) / 1000));
}

function deadline(job: QueueJob, remainingSeconds: number | null): string {
  if (job.end_time) return shortTime(job.end_time);
  if (remainingSeconds !== null) return `in ${formatDuration(remainingSeconds)}`;
  return "unknown";
}

function compareRows(left: RunwayJob, right: RunwayJob): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: RunwayTone): number {
  return { clear: 0, unknown: 1, watch: 2, urgent: 3 }[tone];
}
