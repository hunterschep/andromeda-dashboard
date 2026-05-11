import { formatDuration } from "../api";
import type { QueueJob } from "../types";

export type ActiveBurnTone = "clear" | "gpu" | "urgent";

export type ActiveBurnRow = {
  jobId: string;
  name: string;
  tone: ActiveBurnTone;
  elapsedGpuHours: number;
  remainingGpuHours: number;
  elapsedCpuHours: number;
  remaining: string;
  progress: number | null;
  title: string;
  detail: string;
  action: string;
  command: string;
};

export type ActiveBurn = {
  label: string;
  headline: string;
  activeJobs: number;
  gpuJobs: number;
  elapsedGpuHours: number;
  remainingGpuHours: number;
  elapsedCpuHours: number;
  rows: ActiveBurnRow[];
};

export function buildActiveBurn(jobs: QueueJob[], alias: string): ActiveBurn {
  const rows = jobs.filter((job) => job.state === "RUNNING").map((job) => rowFor(job, alias)).sort(compareRows);
  const elapsedGpuHours = rows.reduce((sum, row) => sum + row.elapsedGpuHours, 0);
  const remainingGpuHours = rows.reduce((sum, row) => sum + row.remainingGpuHours, 0);
  const elapsedCpuHours = rows.reduce((sum, row) => sum + row.elapsedCpuHours, 0);
  const gpuJobs = rows.filter((row) => row.elapsedGpuHours > 0 || row.remainingGpuHours > 0).length;
  return {
    label: `${hours(elapsedGpuHours)} GPU-h burned`,
    headline: headlineFor(rows.length, gpuJobs, remainingGpuHours),
    activeJobs: rows.length,
    gpuJobs,
    elapsedGpuHours,
    remainingGpuHours,
    elapsedCpuHours,
    rows
  };
}

function rowFor(job: QueueJob, alias: string): ActiveBurnRow {
  const elapsed = job.elapsed_seconds ?? 0;
  const remaining = remainingSeconds(job);
  const elapsedGpuHours = (job.gpu_count * elapsed) / 3600;
  const remainingGpuHours = (job.gpu_count * (remaining ?? 0)) / 3600;
  const elapsedCpuHours = (job.cpus * elapsed) / 3600;
  const progress = progressPercent(job);
  const tone = toneFor(job, remaining, progress);
  const name = job.name ?? job.job_id;
  return {
    jobId: job.job_id,
    name,
    tone,
    elapsedGpuHours,
    remainingGpuHours,
    elapsedCpuHours,
    remaining: remaining === null ? "unknown" : formatDuration(remaining),
    progress,
    title: titleFor(job, tone),
    detail: detailFor(name, elapsedGpuHours, elapsedCpuHours, remaining),
    action: actionFor(job, tone, remainingGpuHours),
    command: `ssh ${alias} 'squeue -j ${job.job_id} -o "%i|%j|%T|%M|%l|%b|%R|%N"; sacct -j ${job.job_id} --format=JobID,JobName,State,Elapsed,Timelimit,AllocTRES,TRESUsageInAve,TRESUsageInMax -P'`
  };
}

function headlineFor(active: number, gpuJobs: number, remainingGpuHours: number): string {
  if (!active) return "No running jobs are burning allocation time right now.";
  if (gpuJobs) return `${gpuJobs} running GPU job${gpuJobs === 1 ? "" : "s"} still expose ${hours(remainingGpuHours)} GPU-h before walltime closes.`;
  return `${active} running CPU job${active === 1 ? "" : "s"} are consuming allocation time without GPU burn.`;
}

function detailFor(name: string, gpuHours: number, cpuHours: number, remaining: number | null): string {
  const left = remaining === null ? "unknown walltime remaining" : `${formatDuration(remaining)} of walltime remains`;
  return `${name} has burned ${hours(gpuHours)} GPU-h and ${hours(cpuHours)} CPU-h; ${left}.`;
}

function actionFor(job: QueueJob, tone: ActiveBurnTone, remainingGpuHours: number): string {
  if (tone === "urgent" && job.gpu_count > 0) return `Verify checkpoint before the last ${hours(remainingGpuHours)} GPU-h expires.`;
  if (tone === "urgent") return "Verify output, logs, and checkpoint path before walltime closes.";
  if (job.gpu_count > 0) return "Keep utilization and dataloader health visible while this GPU allocation burns.";
  return "CPU allocation is active; check logs before expanding GPU work behind it.";
}

function titleFor(job: QueueJob, tone: ActiveBurnTone): string {
  if (tone === "urgent") return "Final walltime window";
  if (job.gpu_count > 0) return "GPU burn active";
  return "CPU burn active";
}

function toneFor(job: QueueJob, remaining: number | null, progress: number | null): ActiveBurnTone {
  if ((remaining !== null && remaining <= 3600) || (progress !== null && progress >= 90)) return "urgent";
  if (job.gpu_count > 0) return "gpu";
  return "clear";
}

function remainingSeconds(job: QueueJob): number | null {
  if (!job.time_limit_seconds || job.elapsed_seconds === null || job.elapsed_seconds === undefined) return null;
  return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
}

function progressPercent(job: QueueJob): number | null {
  if (!job.time_limit_seconds || job.elapsed_seconds === null || job.elapsed_seconds === undefined) return null;
  return Math.min(100, Math.round((job.elapsed_seconds / job.time_limit_seconds) * 100));
}

function compareRows(left: ActiveBurnRow, right: ActiveBurnRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.elapsedGpuHours - left.elapsedGpuHours || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: ActiveBurnTone): number {
  return { clear: 0, gpu: 1, urgent: 2 }[tone];
}

export function hours(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString();
  return value.toFixed(value >= 10 ? 1 : 2);
}
