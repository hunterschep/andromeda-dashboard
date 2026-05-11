import { formatDuration } from "../api";
import type { HistoryJob } from "../types";

export type ExitForensicsTone = "critical" | "warning" | "info";

export type ExitForensicsRow = {
  jobId: string;
  name: string;
  state: string;
  exitCode: string;
  tone: ExitForensicsTone;
  title: string;
  detail: string;
  action: string;
  command: string;
};

export type ExitCodeForensics = {
  label: string;
  headline: string;
  rows: ExitForensicsRow[];
};

export function buildExitCodeForensics(jobs: HistoryJob[], alias: string): ExitCodeForensics {
  const rows = jobs.filter(isFailed).map((job) => rowFor(job, alias)).sort(compareRows).slice(0, 5);
  return {
    label: rows.length ? `${rows.length} decoded ${rows.length === 1 ? "failure" : "failures"}` : "no failures",
    headline: headlineFor(rows),
    rows
  };
}

function rowFor(job: HistoryJob, alias: string): ExitForensicsRow {
  const exitCode = job.exit_code ?? "n/a";
  const signal = signalPart(exitCode);
  const gpu = requestedGpu(job);
  const state = job.state.toUpperCase();
  const kind = classify(state, exitCode, signal, gpu);
  return {
    jobId: job.job_id,
    name: job.name ?? job.job_id,
    state: job.state,
    exitCode,
    tone: kind.tone,
    title: kind.title,
    detail: detailFor(job, kind.title, gpu),
    action: kind.action,
    command: `ssh ${alias} 'sacct -j ${job.job_id} --format=JobID,JobName,State,ExitCode,DerivedExitCode,Elapsed,ReqTRES,AllocTRES,MaxRSS,TRESUsageInAve,TRESUsageInMax -P; scontrol show job -dd ${job.job_id} | sed -n "1,140p"'`
  };
}

function classify(state: string, exitCode: string, signal: number | null, gpu: number) {
  if (state.includes("OUT_OF_MEMORY") || signal === 9 || signal === 15) {
    return {
      tone: "critical" as const,
      title: "Scheduler or kernel kill",
      action: "Check MaxRSS, cgroup memory, node health, and whether the process received SIGKILL or SIGTERM."
    };
  }
  if (state.includes("TIMEOUT")) {
    return {
      tone: "warning" as const,
      title: "Walltime exhausted",
      action: "Add checkpoints, shorten the workload, or move to the partition that matches actual runtime."
    };
  }
  if (state.includes("NODE_FAIL") || state.includes("BOOT_FAIL")) {
    return {
      tone: "critical" as const,
      title: "Infrastructure-side failure",
      action: "Resubmit only after checking node health evidence; include this job ID in any support request."
    };
  }
  if (gpu > 0 && exitCode.startsWith("1:")) {
    return {
      tone: "warning" as const,
      title: "Application exited after allocation",
      action: "Start with stderr, CUDA imports, module loads, GPU visibility, and input paths before changing queue shape."
    };
  }
  return {
    tone: "warning" as const,
    title: "Application exit after launch",
    action: "Inspect stdout/stderr and compare requested resources with MaxRSS and elapsed runtime."
  };
}

function detailFor(job: HistoryJob, title: string, gpu: number): string {
  const name = job.name ?? job.job_id;
  const request = requestText(job, gpu);
  if (title === "Application exited after allocation") {
    return `${name} exited with code ${job.exit_code ?? "n/a"} after ${formatDuration(job.runtime_seconds)}; Slurm allocated ${request}, so start with stderr, CUDA imports, module loads, and input paths.`;
  }
  if (title === "Walltime exhausted") {
    return `${name} ran for ${formatDuration(job.runtime_seconds)} before hitting walltime; queue strategy is secondary to checkpointing.`;
  }
  if (title === "Scheduler or kernel kill") {
    return `${name} ended with ${job.exit_code ?? job.state}; compare MaxRSS with requested memory before scaling.`;
  }
  return `${name} reached execution and ended as ${job.state}; use accounting plus resolved logs before resubmitting.`;
}

function requestText(job: HistoryJob, gpu: number): string {
  const source = job.allocated_tres ?? job.requested_tres ?? {};
  const cpu = source.cpu ? `${source.cpu} CPU` : "CPU n/a";
  const mem = source.mem ? `${source.mem}` : "memory n/a";
  return gpu ? `${cpu} / ${mem} / ${gpu} GPU` : `${cpu} / ${mem}`;
}

function headlineFor(rows: ExitForensicsRow[]): string {
  if (!rows.length) return "No failed accounting rows need exit-code translation in this history window.";
  if (rows.some((row) => row.title.includes("after allocation"))) return "At least one job received resources before failing; logs matter more than queue shape.";
  if (rows.some((row) => row.title.includes("kill"))) return "At least one job looks killed by memory, signal, or policy.";
  return "Failed jobs have enough accounting state to separate scheduler failures from application exits.";
}

function isFailed(job: HistoryJob): boolean {
  const state = job.state.toUpperCase();
  return !state.includes("COMPLETED") && !state.includes("RUNNING");
}

function requestedGpu(job: HistoryJob): number {
  const source = job.allocated_tres?.["gres/gpu"] ? job.allocated_tres : job.requested_tres;
  return Number(source?.["gres/gpu"] ?? source?.gpu ?? 0) || 0;
}

function signalPart(exitCode: string): number | null {
  const signal = Number(exitCode.split(":")[1]);
  return Number.isFinite(signal) ? signal : null;
}

function compareRows(left: ExitForensicsRow, right: ExitForensicsRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: ExitForensicsTone): number {
  return { info: 0, warning: 1, critical: 2 }[tone];
}
