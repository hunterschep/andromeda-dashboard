import { formatDuration } from "../api";
import type { GpuPool, NodeResource, QueueJob } from "../types";

export type GpuFlowSegment = {
  key: "active" | "usable" | "impaired" | "returning" | "dated" | "gated" | "undated";
  label: string;
  count: number;
};

export type GpuFlowRow = {
  type: string;
  total: number;
  usable: number;
  active: number;
  impaired: number;
  pending: number;
  pendingDated: number;
  pendingGated: number;
  pendingUndated: number;
  returningSoon: number;
  undatedActive: number;
  largestFree: number;
  tone: "calm" | "busy" | "hot";
  summary: string;
  message: string;
  fleet: GpuFlowSegment[];
  demand: GpuFlowSegment[];
};

type NodeGpu = {
  type: string;
  total: number;
  used: number;
  free: number;
  available: boolean;
};

const TWO_HOURS = 2 * 3600 * 1000;

export function buildGpuFlow(nodes: NodeResource[], pools: GpuPool[], jobs: QueueJob[], nowMs = Date.now()): GpuFlowRow[] {
  const nodeGpus = nodes.flatMap((node) =>
    node.gres.map((gpu) => ({
      type: gpu.type,
      total: gpu.total,
      used: gpu.used,
      free: gpu.free,
      available: node.is_available
    }))
  );
  const types = Array.from(new Set([...pools.map((pool) => pool.type), ...nodeGpus.map((gpu) => gpu.type), ...jobs.flatMap(jobGpuTypes)])).sort();
  return types.map((type) => rowForType(type, nodeGpus, pools.find((pool) => pool.type === type), jobs, nowMs)).filter((row) => row.total || row.pending || row.active);
}

function rowForType(type: string, nodeGpus: NodeGpu[], pool: GpuPool | undefined, jobs: QueueJob[], nowMs: number): GpuFlowRow {
  const family = nodeGpus.filter((gpu) => gpu.type === type);
  const available = family.filter((gpu) => gpu.available);
  const impaired = family.filter((gpu) => !gpu.available).reduce((sum, gpu) => sum + gpu.total, 0);
  const usable = pool?.usable ?? available.reduce((sum, gpu) => sum + gpu.free, 0);
  const active = available.reduce((sum, gpu) => sum + gpu.used, 0);
  const total = Math.max(pool?.total ?? 0, family.reduce((sum, gpu) => sum + gpu.total, 0), usable + active + impaired);
  const largestFree = Math.max(0, ...available.map((gpu) => gpu.free));
  const demand = classifyDemand(type, jobs, nowMs);
  const fleet = compactSegments([
    { key: "active", label: "active", count: active },
    { key: "usable", label: "usable now", count: usable },
    { key: "impaired", label: "impaired", count: impaired }
  ]);
  const demandSegments = compactSegments([
    { key: "returning", label: "returning <2h", count: demand.returningSoon },
    { key: "dated", label: "dated demand", count: demand.pendingDated },
    { key: "gated", label: "dependency-gated demand", count: demand.pendingGated },
    { key: "undated", label: "unplaced demand", count: demand.pendingUndated }
  ]);
  const tone = rowTone(demand.pending, usable, demand.returningSoon, largestFree, demand.maxRequest);
  return {
    type,
    total,
    usable,
    active,
    impaired,
    pending: demand.pending,
    pendingDated: demand.pendingDated,
    pendingGated: demand.pendingGated,
    pendingUndated: demand.pendingUndated,
    returningSoon: demand.returningSoon,
    undatedActive: demand.undatedActive,
    largestFree,
    tone,
    summary: `${demand.pending} demand / ${usable} usable`,
    message: message(type, usable, demand, largestFree),
    fleet,
    demand: demandSegments
  };
}

function classifyDemand(type: string, jobs: QueueJob[], nowMs: number) {
  const demand = {
    pending: 0,
    pendingDated: 0,
    pendingGated: 0,
    pendingUndated: 0,
    returningSoon: 0,
    undatedActive: 0,
    maxRequest: 0,
    nextReturnSeconds: null as number | null
  };
  for (const job of jobs) {
    const count = requestCount(job, type);
    if (!count) continue;
    if (job.state === "PENDING") {
      demand.pending += count;
      demand.maxRequest = Math.max(demand.maxRequest, count);
      if (isGated(job)) demand.pendingGated += count;
      else if (job.estimated_start_time) demand.pendingDated += count;
      else demand.pendingUndated += count;
      continue;
    }
    if (job.state !== "RUNNING" && job.state !== "COMPLETING") continue;
    const end = job.end_time ? new Date(job.end_time).getTime() : Number.NaN;
    if (!Number.isFinite(end) || end <= nowMs) {
      demand.undatedActive += count;
      continue;
    }
    if (end - nowMs <= TWO_HOURS) demand.returningSoon += count;
    const seconds = Math.round((end - nowMs) / 1000);
    demand.nextReturnSeconds = demand.nextReturnSeconds === null ? seconds : Math.min(demand.nextReturnSeconds, seconds);
  }
  return demand;
}

function message(type: string, usable: number, demand: ReturnType<typeof classifyDemand>, largestFree: number): string {
  if (demand.pendingGated > 0) return `${demand.pendingGated} ${type} GPU(s) are gated by dependencies or holds before scheduler fit can resolve.`;
  if (demand.pending > usable + demand.returningSoon) return `${demand.pending} pending ${type} GPU(s) exceed usable capacity plus GPUs returning inside two hours.`;
  if (demand.maxRequest > largestFree) return `Largest visible ${type} fit is ${largestFree}; wide requests may wait behind fragmentation even when some GPUs are free.`;
  if (demand.returningSoon > 0) {
    const when = demand.nextReturnSeconds === null ? "soon" : `in ${formatDuration(demand.nextReturnSeconds)}`;
    return `${demand.returningSoon} ${type} GPU(s) are expected to re-enter the pool ${when}.`;
  }
  if (demand.undatedActive > 0) return `${demand.undatedActive} active ${type} GPU allocation(s) do not expose future end times.`;
  if (usable > 0) return `${usable} ${type} GPU(s) are usable now with no visible pressure from this queue view.`;
  return `No usable ${type} capacity or dated turnover is visible right now.`;
}

function rowTone(pending: number, usable: number, returningSoon: number, largestFree: number, maxRequest: number): GpuFlowRow["tone"] {
  if (pending > usable + returningSoon || maxRequest > Math.max(largestFree, 0)) return "hot";
  if (pending > 0 || returningSoon > 0) return "busy";
  return "calm";
}

function requestCount(job: QueueJob, type: string): number {
  if (job.gpus.length) return job.gpus.filter((gpu) => gpu.type === type).reduce((sum, gpu) => sum + gpu.count, 0);
  return type === "generic" ? job.gpu_count : 0;
}

function jobGpuTypes(job: QueueJob): string[] {
  if (job.gpus.length) return job.gpus.map((gpu) => gpu.type);
  return job.gpu_count > 0 ? ["generic"] : [];
}

function isGated(job: QueueJob): boolean {
  const value = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin|launch/.test(value);
}

function compactSegments(segments: GpuFlowSegment[]): GpuFlowSegment[] {
  return segments.filter((segment) => segment.count > 0);
}
