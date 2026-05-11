import { formatDuration } from "../api";
import type { HistoryJob } from "../types";

export type LifecycleTone = "success" | "failed" | "warning";

export type LifecycleReplayRow = {
  jobId: string;
  name: string;
  partition: string;
  state: string;
  tone: LifecycleTone;
  waitLabel: string;
  runtimeLabel: string;
  waitWeight: number;
  runWeight: number;
  requestedGpu: number;
  headline: string;
  action: string;
  command: string;
};

export type JobLifecycleReplay = {
  label: string;
  summary: string;
  rows: LifecycleReplayRow[];
};

export function buildJobLifecycleReplay(jobs: HistoryJob[], alias: string): JobLifecycleReplay {
  const rows = [...jobs].sort((left, right) => eventTime(right) - eventTime(left)).slice(0, 6).map((job) => row(job, alias));
  const failed = rows.filter((item) => item.tone === "failed").length;
  const gpu = rows.filter((item) => item.requestedGpu > 0).length;
  return {
    label: `${rows.length} recent ${rows.length === 1 ? "lifecycle" : "lifecycles"}`,
    summary: summaryFor(rows.length, failed, gpu),
    rows
  };
}

function row(job: HistoryJob, alias: string): LifecycleReplayRow {
  const wait = Math.max(0, job.wait_seconds ?? 0);
  const runtime = Math.max(0, job.runtime_seconds ?? 0);
  const state = job.state || "UNKNOWN";
  const name = job.name ?? job.job_id;
  const requestedGpu = gpuCount(job);
  return {
    jobId: job.job_id,
    name,
    partition: job.partition ?? "unknown",
    state,
    tone: toneFor(state),
    waitLabel: formatDuration(wait),
    runtimeLabel: formatDuration(runtime),
    waitWeight: stageWeight(wait, runtime),
    runWeight: stageWeight(runtime, wait),
    requestedGpu,
    headline: `${name} spent ${formatDuration(wait)} waiting, ${formatDuration(runtime)} running, then ${state}.`,
    action: actionFor(job, requestedGpu),
    command: `ssh ${alias} 'sacct -j ${job.job_id} --format=JobID,JobName,State,ExitCode,Submit,Start,End,Elapsed,ReqTRES,AllocTRES,TRESUsageInAve,TRESUsageInMax -P'`
  };
}

function summaryFor(total: number, failed: number, gpu: number): string {
  if (!total) return "No completed accounting rows are available for lifecycle replay.";
  if (failed && gpu) return `${failed} failed ${failed === 1 ? "job intersects" : "jobs intersect"} recent GPU allocation history; inspect post-allocation behavior before resubmitting.`;
  if (failed) return `${failed} recent ${failed === 1 ? "job ended" : "jobs ended"} badly; compare wait, runtime, and exit state before changing the request shape.`;
  return "Recent jobs have enough accounting data to compare queue wait against runtime payoff.";
}

function actionFor(job: HistoryJob, requestedGpu: number): string {
  const failed = toneFor(job.state) === "failed";
  if (failed && requestedGpu > 0) return "GPU failure happened after allocation; inspect CUDA, modules, and input data before resubmitting.";
  if (failed) return "The job reached execution before failing; logs and exit code matter more than queue strategy.";
  if ((job.wait_seconds ?? 0) > (job.runtime_seconds ?? 0)) return "Wait dominated this lifecycle; reuse only if the result justified the queue cost.";
  if (requestedGpu > 0) return "This completed GPU shape is a recent baseline for repeat experiments.";
  return "This completed CPU shape is a recent baseline for future submissions.";
}

function toneFor(state: string): LifecycleTone {
  if (state === "COMPLETED") return "success";
  if (["FAILED", "TIMEOUT", "OUT_OF_MEMORY", "NODE_FAIL", "CANCELLED"].includes(state)) return "failed";
  return "warning";
}

function stageWeight(value: number, other: number): number {
  if (!value && !other) return 1;
  if (!value) return 0.12;
  return Math.max(0.22, value / Math.max(1, value + other));
}

function eventTime(job: HistoryJob): number {
  return Math.max(readTime(job.end_time), readTime(job.start_time), readTime(job.submit_time));
}

function readTime(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function gpuCount(job: HistoryJob): number {
  return Math.max(countTres(job.allocated_tres ?? {}), countTres(job.requested_tres ?? {}));
}

function countTres(source: Record<string, string>): number {
  return Object.entries(source).reduce((total, [key, value]) => {
    if (!key.startsWith("gres/gpu") && key !== "gpu") return total;
    return total + (Number(value.match(/\d+/)?.[0] ?? 0) || 0);
  }, 0);
}
