import { formatDuration } from "../api";
import type { QueueJob } from "../types";

export type CheckpointTone = "calm" | "watch" | "urgent" | "unknown";

export type CheckpointJob = {
  jobId: string;
  name: string;
  tone: CheckpointTone;
  progress: number | null;
  remaining: string;
  request: string;
  node: string;
  message: string;
  action: string;
  command: string;
};

export type CheckpointSentinel = {
  running: number;
  urgent: number;
  watch: number;
  unknown: number;
  label: string;
  message: string;
  jobs: CheckpointJob[];
};

export function buildCheckpointSentinel(jobs: QueueJob[], alias: string): CheckpointSentinel {
  const running = jobs.filter((job) => job.state === "RUNNING");
  const rows = running.map((job) => row(job, alias)).sort(compareRows);
  const urgent = rows.filter((item) => item.tone === "urgent").length;
  const watch = rows.filter((item) => item.tone === "watch").length;
  const unknown = rows.filter((item) => item.tone === "unknown").length;
  return {
    running: running.length,
    urgent,
    watch,
    unknown,
    label: labelFor(urgent, watch, unknown),
    message: messageFor(running.length, urgent, watch, unknown),
    jobs: rows
  };
}

function row(job: QueueJob, alias: string): CheckpointJob {
  const progress = progressPercent(job);
  const remainingSeconds = remaining(job);
  const tone = toneFor(progress, remainingSeconds);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone,
    progress,
    remaining: remainingSeconds === null ? "unknown" : formatDuration(remainingSeconds),
    request: `${job.cpus} CPU / ${job.gpu_count} GPU`,
    node: job.nodes[0] ?? "pending",
    message: message(job, tone, remainingSeconds, progress),
    action: actionFor(tone),
    command: checkpointCommand(alias, job.job_id)
  };
}

function progressPercent(job: QueueJob): number | null {
  if (!job.elapsed_seconds || !job.time_limit_seconds) return null;
  return Math.min(100, Math.round((job.elapsed_seconds / job.time_limit_seconds) * 100));
}

function remaining(job: QueueJob): number | null {
  if (!job.time_limit_seconds || job.elapsed_seconds === null || job.elapsed_seconds === undefined) return null;
  return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
}

function toneFor(progress: number | null, remainingSeconds: number | null): CheckpointTone {
  if (progress === null || remainingSeconds === null) return "unknown";
  if (progress >= 90 || remainingSeconds <= 3600) return "urgent";
  if (progress >= 75 || remainingSeconds <= 4 * 3600) return "watch";
  return "calm";
}

function labelFor(urgent: number, watch: number, unknown: number): string {
  if (urgent) return `${urgent} urgent deadline${urgent === 1 ? "" : "s"}`;
  if (watch) return `${watch} checkpoint watch`;
  if (unknown) return `${unknown} unknown limit${unknown === 1 ? "" : "s"}`;
  return "deadlines clear";
}

function messageFor(running: number, urgent: number, watch: number, unknown: number): string {
  if (!running) return "No running jobs are visible for the configured user.";
  if (urgent) return "At least one running job is close enough to its Slurm limit that checkpoint/log verification should happen now.";
  if (watch) return "A running job is entering the checkpoint watch window; confirm outputs before the final hour.";
  if (unknown) return "Some running jobs do not expose walltime cleanly; inspect them before relying on turnover estimates.";
  return "Running jobs have visible walltime headroom; keep normal monitoring on logs and GPU utilization.";
}

function message(job: QueueJob, tone: CheckpointTone, remainingSeconds: number | null, progress: number | null): string {
  if (tone === "urgent") return `${job.name ?? job.job_id} is ${progress ?? "near"}% through walltime with ${formatDuration(remainingSeconds)} left.`;
  if (tone === "watch") return `${job.name ?? job.job_id} has ${formatDuration(remainingSeconds)} left; checkpoint cadence should be visible in logs.`;
  if (tone === "unknown") return `${job.name ?? job.job_id} is running without a parsed walltime deadline.`;
  return `${job.name ?? job.job_id} has ${formatDuration(remainingSeconds)} left before the Slurm limit.`;
}

function actionFor(tone: CheckpointTone): string {
  if (tone === "urgent") return "Verify latest checkpoint, stderr, stdout, and output path before walltime expires.";
  if (tone === "watch") return "Confirm checkpoint cadence and output growth while there is still room to react.";
  if (tone === "unknown") return "Inspect scontrol and accounting details to recover deadline visibility.";
  return "Keep watching logs and utilization; no immediate checkpoint intervention is visible.";
}

function checkpointCommand(alias: string, jobId: string): string {
  return `ssh ${alias} ${shellQuote(`scontrol show job -dd ${jobId} | sed -n "1,120p"; sacct -j ${jobId} --format=JobID,State,Elapsed,Timelimit,End,ReqTRES,AllocTRES -P; out=$(scontrol show job -dd ${jobId} | sed -n "s/.*StdOut=\\([^ ]*\\).*/\\1/p"); if [[ -n "$out" && "$out" != "(null)" ]]; then tail -n 80 "$out"; fi`)}`;
}

function compareRows(left: CheckpointJob, right: CheckpointJob): number {
  return toneRank(right.tone) - toneRank(left.tone) || (right.progress ?? -1) - (left.progress ?? -1) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: CheckpointTone): number {
  return { calm: 0, unknown: 1, watch: 2, urgent: 3 }[tone];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
