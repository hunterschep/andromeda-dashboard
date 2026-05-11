import { formatDuration } from "../api";
import type { HistoryJob, HistoryResponse, QueueJob } from "../types";

export type ExperimentContinuityTone = "steady" | "watch" | "risk";

export type ExperimentContinuityRow = {
  jobId: string;
  name: string;
  tone: ExperimentContinuityTone;
  signal: string;
  detail: string;
  action: string;
  evidence: string[];
  command: string;
};

export type ExperimentContinuity = {
  label: string;
  headline: string;
  rows: ExperimentContinuityRow[];
  command: string;
};

type HistorySummary = {
  total: number;
  clean: number;
  failed: number;
  cleanRate: number | null;
  gpuFailures: number;
};

export function buildExperimentContinuity({
  jobs,
  history,
  alias
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  alias: string;
}): ExperimentContinuity {
  const active = jobs.filter((job) => job.state === "RUNNING" || job.state === "PENDING");
  const recent = history?.jobs ?? [];
  const summary = summarize(recent);
  const rows = active.map((job) => rowFor(job, recent, summary, alias)).sort(compareRows).slice(0, 5);
  return {
    label: `${active.length} active / ${summary.cleanRate === null ? "n/a" : `${summary.cleanRate}%`} clean / ${summary.failed} failed`,
    headline: headlineFor(active.length, summary),
    rows,
    command: `ssh ${alias} 'squeue -u "$USER" -o "%i|%j|%T|%M|%l|%D|%C|%m|%b|%R"; sacct -u "$USER" --starttime=now-14days --format=JobID,JobName,State,ExitCode,Elapsed,ReqTRES,AllocTRES,TRESUsageInAve -P'`
  };
}

function rowFor(
  job: QueueJob,
  history: HistoryJob[],
  summary: HistorySummary,
  alias: string
): ExperimentContinuityRow {
  const matches = history.filter((item) => sameExperiment(job, item));
  const recentFailure = matches.find((item) => isFailure(item.state));
  const recentClean = matches.find((item) => isClean(item.state));
  if (isNotebook(job)) return notebookRow(job, alias);
  if (recentFailure) return failureRow(job, recentFailure, matches, alias);
  if (recentClean) return cleanRow(job, recentClean, matches, alias);
  return freshBaselineRow(job, summary, alias);
}

function notebookRow(job: QueueJob, alias: string): ExperimentContinuityRow {
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone: "watch",
    signal: "interactive continuity",
    detail: `${job.name ?? job.job_id} is an interactive session; protect the tunnel and output path before walltime closes.`,
    action: "Copy the tunnel and allocation probes before changing notebooks or kernels.",
    evidence: [`${formatDuration(job.elapsed_seconds)} elapsed`, `${formatDuration(job.time_limit_seconds)} limit`, job.nodes[0] ?? "pending node"],
    command: `ssh ${alias} 'scontrol show job -dd ${job.job_id} | sed -n "1,120p"; squeue -j ${job.job_id} --start'`
  };
}

function failureRow(job: QueueJob, failure: HistoryJob, matches: HistoryJob[], alias: string): ExperimentContinuityRow {
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone: "risk",
    signal: "repeat failure risk",
    detail: `${job.name ?? job.job_id} has a recent matching failure (${failure.state}); do not scale this shape until logs explain it.`,
    action: "Compare stderr, modules, CUDA visibility, and requested TRES against the failed run.",
    evidence: evidenceFor(matches),
    command: `ssh ${alias} 'sacct -j ${job.job_id},${failure.job_id} --format=JobID,JobName,State,ExitCode,Elapsed,ReqTRES,AllocTRES,MaxRSS,TRESUsageInAve -P; scontrol show job -dd ${job.job_id} | sed -n "1,120p"'`
  };
}

function cleanRow(job: QueueJob, clean: HistoryJob, matches: HistoryJob[], alias: string): ExperimentContinuityRow {
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone: "steady",
    signal: "known-good baseline",
    detail: `${job.name ?? job.job_id} has a recent clean baseline from ${clean.job_id}; compare runtime and TRES before changing shape.`,
    action: "Keep this shape unless the active run drifts from baseline runtime or utilization.",
    evidence: evidenceFor(matches),
    command: `ssh ${alias} 'sacct -j ${job.job_id},${clean.job_id} --format=JobID,JobName,State,Elapsed,ReqTRES,AllocTRES,MaxRSS,TRESUsageInAve -P'`
  };
}

function freshBaselineRow(job: QueueJob, summary: HistorySummary, alias: string): ExperimentContinuityRow {
  const clean = summary.cleanRate === null ? "unknown" : `${summary.cleanRate}%`;
  const gpu = summary.gpuFailures === 1 ? "1 GPU failure" : `${summary.gpuFailures} GPU failures`;
  const tone = job.gpu_count > 0 || summary.cleanRate === null || summary.cleanRate < 70 ? "watch" : "steady";
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone,
    signal: "fresh baseline",
    detail: `${job.name ?? job.job_id} is establishing a fresh baseline; recent history is ${clean} clean with ${gpu}.`,
    action: job.gpu_count > 0 ? "Confirm checkpoints and capture GPU telemetry before this run becomes the reference." : "Capture runtime, memory, and output paths so the next submission has a baseline.",
    evidence: [`${job.cpus} CPU`, `${job.gpu_count} GPU`, job.partition ?? "n/a"],
    command: `ssh ${alias} 'scontrol show job -dd ${job.job_id} | sed -n "1,140p"; sacct -j ${job.job_id} --format=JobID,JobName,State,Elapsed,ReqTRES,AllocTRES,TRESUsageInAve -P'`
  };
}

function evidenceFor(matches: HistoryJob[]): string[] {
  const latest = matches.slice(0, 3);
  if (!latest.length) return ["no matching history"];
  return latest.map((job) => `${job.job_id} ${job.state} / ${formatDuration(job.runtime_seconds)}`);
}

function summarize(history: HistoryJob[]): HistorySummary {
  const total = history.length;
  const clean = history.filter((job) => isClean(job.state)).length;
  const failed = history.filter((job) => isFailure(job.state)).length;
  return {
    total,
    clean,
    failed,
    cleanRate: total ? Math.round((clean / total) * 100) : null,
    gpuFailures: history.filter((job) => isFailure(job.state) && requestedGpu(job) > 0).length
  };
}

function headlineFor(active: number, summary: HistorySummary): string {
  if (!active) return "No active experiments need continuity tracking.";
  if (!summary.total) return "Active experiments have no recent accounting baseline yet.";
  if (summary.gpuFailures) return `${summary.gpuFailures} recent GPU failure${summary.gpuFailures === 1 ? "" : "s"} should inform active experiment monitoring.`;
  if (summary.cleanRate !== null && summary.cleanRate >= 80) return "Recent accounting is mostly clean; compare active runs against known-good baselines.";
  return "Recent accounting is mixed; treat active jobs as evidence-gathering runs before scaling.";
}

function sameExperiment(job: QueueJob, history: HistoryJob): boolean {
  const left = normalize(job.name);
  const right = normalize(history.name);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function normalize(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(run|job|test|trial|copy)\b/g, "")
    .replace(/[._-]?\d+$/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function isNotebook(job: QueueJob): boolean {
  return /jupyter|notebook|lab/i.test(job.name ?? "") || job.partition === "interactive";
}

function isClean(state: string): boolean {
  return state.toUpperCase().includes("COMPLETED");
}

function isFailure(state: string): boolean {
  return !isClean(state) && !state.toUpperCase().includes("RUNNING");
}

function requestedGpu(job: HistoryJob): number {
  const raw = job.requested_tres["gres/gpu"] ?? job.allocated_tres["gres/gpu"] ?? job.requested_tres.gpu ?? job.allocated_tres.gpu;
  return Number(raw ?? 0) || 0;
}

function compareRows(left: ExperimentContinuityRow, right: ExperimentContinuityRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: ExperimentContinuityTone): number {
  return { steady: 0, watch: 1, risk: 2 }[tone];
}
