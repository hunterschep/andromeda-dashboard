import type { GpuPool, NodeResource, QueueJob } from "../types";

export type GpuMarketTone = "open" | "watch" | "hot";

export type GpuMarketTapeRow = {
  type: string;
  tone: GpuMarketTone;
  total: number;
  used: number;
  usable: number;
  blocked: number;
  pending: number;
  gated: number;
  returningSoon: number;
  shortfall: number;
  pressure: number;
  status: string;
  summary: string;
  action: string;
  command: string;
};

export type GpuMarketTape = {
  label: string;
  headline: string;
  rows: GpuMarketTapeRow[];
};

type NodeGpu = {
  type: string;
  total: number;
  used: number;
  free: number;
  available: boolean;
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function buildGpuMarketTape(
  nodes: NodeResource[],
  pools: GpuPool[],
  jobs: QueueJob[],
  alias: string,
  nowMs = Date.now()
): GpuMarketTape {
  const nodeGpus = nodes.flatMap((node) => node.gres.map((gpu) => ({
    type: gpu.type,
    total: gpu.total,
    used: gpu.used,
    free: gpu.free,
    available: node.is_available
  })));
  const types = Array.from(new Set([...nodeGpus.map((gpu) => gpu.type), ...pools.map((pool) => pool.type), ...jobs.flatMap(jobTypes)])).sort();
  const rows = types.map((type) => rowFor(type, nodeGpus, pools.find((pool) => pool.type === type), jobs, alias, nowMs));
  const hot = rows.filter((row) => row.tone === "hot").length;
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  return {
    label: `${hot} hot ${hot === 1 ? "family" : "families"}`,
    headline: headlineFor(rows, pending),
    rows
  };
}

function rowFor(
  type: string,
  gpus: NodeGpu[],
  pool: GpuPool | undefined,
  jobs: QueueJob[],
  alias: string,
  nowMs: number
): GpuMarketTapeRow {
  const family = gpus.filter((gpu) => gpu.type === type);
  const available = family.filter((gpu) => gpu.available);
  const used = available.reduce((sum, gpu) => sum + gpu.used, 0);
  const blocked = family.filter((gpu) => !gpu.available).reduce((sum, gpu) => sum + gpu.total, 0);
  const usable = pool?.usable ?? available.reduce((sum, gpu) => sum + gpu.free, 0);
  const total = Math.max(pool?.total ?? 0, family.reduce((sum, gpu) => sum + gpu.total, 0), used + usable + blocked);
  const demand = demandFor(type, jobs, nowMs);
  const shortfall = Math.max(0, demand.pending - usable - demand.returningSoon);
  const pressure = demand.pending ? Math.round((demand.pending / Math.max(1, usable + demand.returningSoon)) * 100) : 0;
  const tone = toneFor(shortfall, demand.pending, demand.gated, blocked);
  return {
    type,
    tone,
    total,
    used,
    usable,
    blocked,
    pending: demand.pending,
    gated: demand.gated,
    returningSoon: demand.returningSoon,
    shortfall,
    pressure,
    status: statusFor(shortfall, demand.gated, blocked, demand.pending),
    summary: summaryFor(type, demand.pending, usable, blocked, shortfall, demand.gated),
    action: actionFor(shortfall, demand.gated, blocked, demand.pending),
    command: probe(alias, type)
  };
}

function demandFor(type: string, jobs: QueueJob[], nowMs: number) {
  const demand = { pending: 0, gated: 0, returningSoon: 0 };
  for (const job of jobs) {
    const count = requestCount(job, type);
    if (!count) continue;
    if (job.state === "PENDING") {
      demand.pending += count;
      if (isGated(job)) demand.gated += count;
      continue;
    }
    if (job.state !== "RUNNING" && job.state !== "COMPLETING") continue;
    const end = job.end_time ? Date.parse(job.end_time) : Number.NaN;
    if (Number.isFinite(end) && end > nowMs && end - nowMs <= TWO_HOURS_MS) demand.returningSoon += count;
  }
  return demand;
}

function headlineFor(rows: GpuMarketTapeRow[], pending: number): string {
  if (!rows.length) return "No GPU family inventory is visible in this snapshot.";
  const hottest = [...rows].sort((left, right) => right.pressure - left.pressure || right.shortfall - left.shortfall)[0];
  if (hottest.shortfall) return `${hottest.type} has the tightest tape: ${hottest.shortfall} GPU short after visible supply and near-term returns.`;
  if (pending) return `${pending} pending GPU request(s) are visible, but current supply covers them on paper.`;
  return "No pending GPU pressure is visible against current accelerator supply.";
}

function summaryFor(type: string, pending: number, usable: number, blocked: number, shortfall: number, gated: number): string {
  if (shortfall) return `${type} scarcity is active: ${pending} pending GPU request(s) against ${usable} usable now; ${blocked} GPU are blocked by unavailable nodes.`;
  if (gated) return `${gated} pending ${type} GPU request(s) are gated before capacity can matter; ${usable} usable remain visible.`;
  if (blocked) return `${blocked} ${type} GPU are visible but unavailable; ${usable} usable remain in the schedulable pool.`;
  if (pending) return `${pending} pending ${type} GPU request(s) can fit the ${usable} usable GPU supply on paper.`;
  return `${usable} ${type} GPU are usable now with no visible pending pressure.`;
}

function actionFor(shortfall: number, gated: number, blocked: number, pending: number): string {
  if (shortfall) return "Plan around scarcity: split wide requests, watch return times, or use a smaller validation run.";
  if (gated) return "Clear dependency or hold gates before reshaping GPU requests.";
  if (blocked && pending) return "Treat paper capacity carefully until node health clears.";
  if (pending) return "Capacity exists on paper; priority, topology, or walltime may be the next limiter.";
  return "Good window for short GPU probes if storage and environment checks are clean.";
}

function toneFor(shortfall: number, pending: number, gated: number, blocked: number): GpuMarketTone {
  if (shortfall || gated > 0) return "hot";
  if (pending || blocked) return "watch";
  return "open";
}

function statusFor(shortfall: number, gated: number, blocked: number, pending: number): string {
  if (shortfall) return `short ${shortfall} GPU`;
  if (gated) return `${gated} gated`;
  if (blocked) return `${blocked} blocked`;
  return pending ? "covered" : "open";
}

function requestCount(job: QueueJob, type: string): number {
  if (job.gpus.length) return job.gpus.filter((gpu) => gpu.type === type).reduce((sum, gpu) => sum + gpu.count, 0);
  return type === "generic" ? job.gpu_count : 0;
}

function jobTypes(job: QueueJob): string[] {
  if (job.gpus.length) return job.gpus.map((gpu) => gpu.type);
  return job.gpu_count ? ["generic"] : [];
}

function isGated(job: QueueJob): boolean {
  const value = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin|launch/.test(value);
}

function probe(alias: string, type: string): string {
  const family = type.replace(/'/g, "'\\''");
  return `ssh ${alias} 'sinfo -Nel -o "%N|%t|%G|%P|%m|%C|%E" | grep -i -- "${family}"; squeue -t R,PD -O JobID:12,Name:24,UserName:16,State:12,Reason:28,TresPerNode:24,EndTime:22,NodeList:24'`;
}
