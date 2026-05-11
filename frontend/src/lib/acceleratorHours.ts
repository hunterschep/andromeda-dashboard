import { hours } from "./computeCommitment";
import type { GpuPool, QueueJob } from "../types";

export type AcceleratorHourTone = "clear" | "busy" | "hot";

export type AcceleratorHourRow = {
  type: string;
  tone: AcceleratorHourTone;
  runningHours: number;
  queuedHours: number;
  gatedHours: number;
  undatedGpu: number;
  runningGpu: number;
  queuedGpu: number;
  supply: number;
  summary: string;
  action: string;
  command: string;
};

export type AcceleratorHourLedger = {
  label: string;
  headline: string;
  rows: AcceleratorHourRow[];
};

type Family = {
  type: string;
  supply: number;
  runningHours: number;
  queuedHours: number;
  gatedHours: number;
  undatedGpu: number;
  runningGpu: number;
  queuedGpu: number;
};

export function buildAcceleratorHourLedger(pools: GpuPool[], jobs: QueueJob[], alias: string): AcceleratorHourLedger {
  const families = new Map<string, Family>();
  for (const pool of pools) {
    const family = ensure(families, pool.type);
    family.supply = Math.max(family.supply, pool.total);
  }
  for (const job of jobs) {
    if (job.gpu_count <= 0 || (job.state !== "RUNNING" && job.state !== "PENDING")) continue;
    for (const request of requests(job)) applyJob(ensure(families, request.type), job, request.count);
  }
  const rows = Array.from(families.values()).map((family) => rowFor(family, alias)).filter((row) => row.supply || row.runningGpu || row.queuedGpu).sort(compareRows);
  const hot = rows.filter((row) => row.tone === "hot").length;
  const totalRunning = rows.reduce((sum, row) => sum + row.runningHours, 0);
  return {
    label: `${hot} hot / ${hours(totalRunning)} locked GPU-h`,
    headline: headline(rows),
    rows
  };
}

function applyJob(family: Family, job: QueueJob, count: number) {
  const committed = committedHours(job);
  const gpuHours = count * (committed ?? 0);
  if (job.state === "RUNNING") {
    family.runningGpu += count;
    family.runningHours += gpuHours;
    if (committed === null) family.undatedGpu += count;
    return;
  }
  family.queuedGpu += count;
  family.queuedHours += gpuHours;
  family.gatedHours += isGated(job) ? gpuHours : 0;
  if (committed === null) family.undatedGpu += count;
}

function rowFor(family: Family, alias: string): AcceleratorHourRow {
  const tone = toneFor(family);
  return {
    type: family.type,
    tone,
    runningHours: family.runningHours,
    queuedHours: family.queuedHours,
    gatedHours: family.gatedHours,
    undatedGpu: family.undatedGpu,
    runningGpu: family.runningGpu,
    queuedGpu: family.queuedGpu,
    supply: family.supply,
    summary: summaryFor(family),
    action: actionFor(family),
    command: commandFor(alias, family.type)
  };
}

function headline(rows: AcceleratorHourRow[]): string {
  if (!rows.length) return "No accelerator hour ledger can be built from this snapshot.";
  const undated = rows.reduce((sum, row) => sum + row.undatedGpu, 0);
  if (undated) return `${undated} queued or running GPU request${undated === 1 ? "" : "s"} lack walltime, making accelerator turnover harder to trust.`;
  const busiest = [...rows].sort((left, right) => right.runningHours + right.queuedHours - (left.runningHours + left.queuedHours))[0];
  if (busiest.runningHours + busiest.queuedHours > 0) return `${busiest.type} carries the largest visible accelerator-hour commitment.`;
  return "Accelerator supply is visible with no dated GPU-hour demand in this queue view.";
}

function summaryFor(family: Family): string {
  if (family.undatedGpu) return `${family.type} has ${hours(family.runningHours)} locked GPU-h plus ${family.undatedGpu} GPU request${family.undatedGpu === 1 ? "" : "s"} without walltime.`;
  if (family.queuedHours) return `${family.type} has ${hours(family.runningHours)} locked GPU-h and ${hours(family.queuedHours)} queued GPU-h.`;
  if (family.runningHours) return `${family.type} has ${hours(family.runningHours)} GPU-h still locked by running work.`;
  return `${family.type} has no dated GPU-hour commitment in this view.`;
}

function actionFor(family: Family): string {
  if (family.undatedGpu) return "Declare realistic walltime before trusting release forecasts or launching dependent GPU work.";
  if (family.gatedHours) return "Clear gates before counting queued GPU-hours as capacity pressure.";
  if (family.queuedHours > family.runningHours) return "Split or shorten queued GPU work before adding another wide request.";
  if (family.runningHours) return "Watch release timing before stacking more same-family GPU demand.";
  return "Good family for short validation work if storage and environment checks are clean.";
}

function toneFor(family: Family): AcceleratorHourTone {
  if (family.undatedGpu || family.queuedGpu > family.supply) return "hot";
  if (family.queuedGpu || family.runningGpu) return "busy";
  return "clear";
}

function committedHours(job: QueueJob): number | null {
  if (!job.time_limit_seconds) return null;
  if (job.state === "RUNNING") return Math.max(0, (job.time_limit_seconds - (job.elapsed_seconds ?? 0)) / 3600);
  return job.time_limit_seconds / 3600;
}

function requests(job: QueueJob): { type: string; count: number }[] {
  if (job.gpus.length) return job.gpus.map((gpu) => ({ type: gpu.type, count: gpu.count }));
  return [{ type: "generic", count: job.gpu_count }];
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function ensure(families: Map<string, Family>, type: string): Family {
  const existing = families.get(type);
  if (existing) return existing;
  const family = { type, supply: 0, runningHours: 0, queuedHours: 0, gatedHours: 0, undatedGpu: 0, runningGpu: 0, queuedGpu: 0 };
  families.set(type, family);
  return family;
}

function compareRows(left: AcceleratorHourRow, right: AcceleratorHourRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.runningHours + right.queuedHours - (left.runningHours + left.queuedHours) || left.type.localeCompare(right.type);
}

function toneRank(tone: AcceleratorHourTone): number {
  return { clear: 0, busy: 1, hot: 2 }[tone];
}

function commandFor(alias: string, type: string): string {
  const family = type.replace(/'/g, "'\\''");
  return `ssh ${alias} 'squeue -t R,PD -O JobID:12,Name:24,UserName:16,State:12,TimeUsed:12,TimeLimit:12,TresPerNode:24,Reason:32,EndTime:22 | grep -i -- "${family}" || true; sacct --starttime=now-7days --format=JobID,State,Elapsed,Timelimit,AllocTRES,ReqTRES -P | grep -i -- "${family}" || true'`;
}
