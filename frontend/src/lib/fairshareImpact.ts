import type { HistoryJob, QueueJob } from "../types";

export type FairshareImpact = {
  recentGpuHours: number;
  activeGpuHours: number;
  remainingGpuHours: number;
  pendingGpuHours: number;
  projectedGpuHours: number;
  undatedJobs: number;
  tier: "low" | "medium" | "high";
  label: string;
  message: string;
  action: string;
  rows: FairshareImpactRow[];
};

export type FairshareImpactRow = {
  label: string;
  gpuHours: number;
  cpuHours: number;
  tone: "calm" | "busy" | "hot";
};

export function buildFairshareImpact(history: HistoryJob[], jobs: QueueJob[]): FairshareImpact {
  const recent = history.reduce((total, job) => total + historyGpuHours(job), 0);
  const active = jobs.filter((job) => job.state === "RUNNING");
  const pending = jobs.filter((job) => job.state === "PENDING");
  const activeGpuHours = active.reduce((total, job) => total + (job.gpu_count * (job.elapsed_seconds ?? 0)) / 3600, 0);
  const remainingGpuHours = active.reduce((total, job) => total + job.gpu_count * remainingHours(job), 0);
  const pendingGpuHours = pending.reduce((total, job) => total + job.gpu_count * requestedHours(job), 0);
  const projectedGpuHours = recent + activeGpuHours + remainingGpuHours + pendingGpuHours;
  const undatedJobs = jobs.filter((job) => job.gpu_count > 0 && !job.time_limit_seconds).length;
  const tier = tierFor(projectedGpuHours);
  return {
    recentGpuHours: recent,
    activeGpuHours,
    remainingGpuHours,
    pendingGpuHours,
    projectedGpuHours,
    undatedJobs,
    tier,
    label: `${tier} projected`,
    message: messageFor(tier, activeGpuHours + remainingGpuHours + pendingGpuHours, undatedJobs),
    action: actionFor(tier, undatedJobs),
    rows: rowsFor(history, jobs)
  };
}

function rowsFor(history: HistoryJob[], jobs: QueueJob[]): FairshareImpactRow[] {
  const rows: FairshareImpactRow[] = [
    {
      label: "recent accounting",
      gpuHours: history.reduce((total, job) => total + historyGpuHours(job), 0),
      cpuHours: history.reduce((total, job) => total + historyCpuHours(job), 0),
      tone: "calm"
    },
    {
      label: "active elapsed",
      gpuHours: jobs.filter((job) => job.state === "RUNNING").reduce((total, job) => total + (job.gpu_count * (job.elapsed_seconds ?? 0)) / 3600, 0),
      cpuHours: jobs.filter((job) => job.state === "RUNNING").reduce((total, job) => total + (job.cpus * (job.elapsed_seconds ?? 0)) / 3600, 0),
      tone: "busy"
    },
    {
      label: "remaining request",
      gpuHours: jobs.filter((job) => job.state === "RUNNING").reduce((total, job) => total + job.gpu_count * remainingHours(job), 0),
      cpuHours: jobs.filter((job) => job.state === "RUNNING").reduce((total, job) => total + job.cpus * remainingHours(job), 0),
      tone: "busy"
    },
    {
      label: "pending request",
      gpuHours: jobs.filter((job) => job.state === "PENDING").reduce((total, job) => total + job.gpu_count * requestedHours(job), 0),
      cpuHours: jobs.filter((job) => job.state === "PENDING").reduce((total, job) => total + job.cpus * requestedHours(job), 0),
      tone: "hot"
    }
  ];
  return rows.filter((row) => row.gpuHours > 0 || row.cpuHours > 0);
}

function historyGpuHours(job: HistoryJob): number {
  return requestedGpu(job) * ((job.runtime_seconds ?? 0) / 3600);
}

function historyCpuHours(job: HistoryJob): number {
  return requestedCpu(job) * ((job.runtime_seconds ?? 0) / 3600);
}

function remainingHours(job: QueueJob): number {
  if (!job.time_limit_seconds) return 0;
  return Math.max(0, (job.time_limit_seconds - (job.elapsed_seconds ?? 0)) / 3600);
}

function requestedHours(job: QueueJob): number {
  return job.time_limit_seconds ? job.time_limit_seconds / 3600 : 0;
}

function requestedGpu(job: HistoryJob): number {
  return Number(job.allocated_tres?.["gres/gpu"] ?? job.requested_tres?.["gres/gpu"] ?? job.requested_tres?.gpu ?? 0) || 0;
}

function requestedCpu(job: HistoryJob): number {
  return Number(job.allocated_tres?.cpu ?? job.requested_tres?.cpu ?? 0) || 0;
}

function tierFor(gpuHours: number): FairshareImpact["tier"] {
  if (gpuHours >= 48) return "high";
  if (gpuHours >= 12) return "medium";
  return "low";
}

function messageFor(tier: FairshareImpact["tier"], activeAndQueued: number, undated: number): string {
  if (undated) return `${undated} GPU job(s) hide walltime, so the fairshare forecast is incomplete.`;
  if (tier === "high") return `Current and recent GPU usage can materially cool fairshare; ${hours(activeAndQueued)} GPU-h are still tied to active or queued work.`;
  if (tier === "medium") return `Current jobs add ${hours(activeAndQueued)} GPU-h to recent usage; priority may soften after this run finishes.`;
  return `Projected GPU usage is light; priority pressure is more likely from fit, QOS, or partition contention.`;
}

function actionFor(tier: FairshareImpact["tier"], undated: number): string {
  if (undated) return "Add explicit walltime so turnover and fairshare impact can be forecast.";
  if (tier === "high") return "Batch low-priority sweeps later and keep urgent work narrow while usage cools off.";
  if (tier === "medium") return "Prefer smaller validation jobs before launching another wide GPU allocation.";
  return "Fairshare should not be the first suspect if new jobs pend.";
}

export function hours(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString();
  return value.toFixed(value >= 10 ? 1 : 2);
}
