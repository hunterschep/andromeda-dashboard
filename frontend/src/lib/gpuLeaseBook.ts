import { formatDuration } from "../api";
import type { NodeResource, QueueJob } from "../types";

export type GpuLeaseTone = "returning" | "holding" | "opaque";

export type GpuLeaseRow = {
  id: string;
  jobId: string;
  jobName: string;
  user: string;
  type: string;
  count: number;
  nodes: string;
  remaining: string;
  queuedBehind: number;
  gatedBehind: number;
  heldPercent: number;
  tone: GpuLeaseTone;
  summary: string;
  action: string;
  command: string;
};

export type GpuLeaseBook = {
  label: string;
  headline: string;
  rows: GpuLeaseRow[];
};

export function buildGpuLeaseBook(nodes: NodeResource[], jobs: QueueJob[], alias: string, nowMs = Date.now()): GpuLeaseBook {
  const totals = familyTotals(nodes);
  const pending = pendingDemand(jobs);
  const rows = jobs
    .filter((job) => (job.state === "RUNNING" || job.state === "COMPLETING") && job.gpu_count > 0)
    .flatMap((job) => requests(job).map((request) => rowFor(job, request, pending, totals, alias, nowMs)))
    .sort(compareRows);
  const leased = rows.reduce((sum, row) => sum + row.count, 0);
  const queued = rows.reduce((sum, row) => sum + row.queuedBehind, 0);
  return {
    label: `${rows.length} visible lease${rows.length === 1 ? "" : "s"}`,
    headline: headline(rows, leased, queued),
    rows
  };
}

function rowFor(
  job: QueueJob,
  request: { type: string; count: number },
  pending: Map<string, { total: number; gated: number }>,
  totals: Map<string, number>,
  alias: string,
  nowMs: number
): GpuLeaseRow {
  const remainingSeconds = releaseSeconds(job, nowMs);
  const queue = pending.get(request.type) ?? { total: 0, gated: 0 };
  const tone = toneFor(remainingSeconds);
  const release = remainingSeconds === null ? null : formatDuration(remainingSeconds);
  const remaining = release === null ? "undated" : `${release} left`;
  const nodes = job.nodes.join(", ") || "node not exposed";
  return {
    id: `${job.job_id}-${request.type}`,
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    user: job.user,
    type: request.type,
    count: request.count,
    nodes,
    remaining,
    queuedBehind: queue.total,
    gatedBehind: queue.gated,
    heldPercent: Math.round((request.count / Math.max(1, totals.get(request.type) ?? request.count)) * 100),
    tone,
    summary: summaryFor(job, request, queue, release, nodes),
    action: actionFor(tone, queue.total, queue.gated),
    command: probe(alias, job.job_id, request.type)
  };
}

function headline(rows: GpuLeaseRow[], leased: number, queued: number): string {
  if (!rows.length) return "No running GPU leases are visible in this queue scope.";
  const opaque = rows.filter((row) => row.tone === "opaque").length;
  const returning = rows.filter((row) => row.tone === "returning").reduce((sum, row) => sum + row.count, 0);
  if (opaque) return `${opaque} GPU lease${opaque === 1 ? "" : "s"} lack release timing, so turnover math is incomplete.`;
  if (returning && queued) return `${returning} leased GPU${returning === 1 ? "" : "s"} are due back soon while ${queued} same-family GPU request${queued === 1 ? "" : "s"} wait.`;
  if (queued) return `${leased} GPU${leased === 1 ? "" : "s"} held by running jobs; ${queued} same-family GPU request${queued === 1 ? "" : "s"} are waiting behind them.`;
  return `${leased} GPU${leased === 1 ? "" : "s"} are leased by running jobs with no same-family pending demand visible.`;
}

function summaryFor(
  job: QueueJob,
  request: { type: string; count: number },
  queue: { total: number; gated: number },
  release: string | null,
  nodes: string
): string {
  const name = job.name ?? job.job_id;
  const held = `${request.count} ${request.type} GPU${request.count === 1 ? "" : "s"}`;
  if (release === null) return `${name} holds ${held} on ${nodes}, but Slurm did not expose release timing.`;
  if (queue.total) return `${name} holds ${held} on ${nodes} for another ${release}; ${queue.total} ${request.type} GPU request${queue.total === 1 ? "" : "s"} are queued behind it, including ${queue.gated} gated before capacity.`;
  return `${name} holds ${held} on ${nodes} for another ${release}; no same-family demand is visible behind it.`;
}

function actionFor(tone: GpuLeaseTone, queued: number, gated: number): string {
  if (tone === "opaque") return "Probe scontrol and sacct before trusting GPU turnover forecasts.";
  if (tone === "returning" && queued > gated) return "Watch this lease for near-term release and keep a narrow fallback shape ready.";
  if (gated) return "Clear dependency or hold gates before treating this lease as the main bottleneck.";
  if (queued) return "This lease is the visible supply edge; avoid cancelling age unless reshaping materially improves fit.";
  return "Capacity is leased but not contested by visible same-family pending work.";
}

function familyTotals(nodes: NodeResource[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const node of nodes) {
    for (const gpu of node.gres) totals.set(gpu.type, (totals.get(gpu.type) ?? 0) + gpu.total);
  }
  return totals;
}

function pendingDemand(jobs: QueueJob[]): Map<string, { total: number; gated: number }> {
  const demand = new Map<string, { total: number; gated: number }>();
  for (const job of jobs) {
    if (job.state !== "PENDING" || job.gpu_count <= 0) continue;
    for (const request of requests(job)) {
      const item = demand.get(request.type) ?? { total: 0, gated: 0 };
      item.total += request.count;
      item.gated += isGated(job) ? request.count : 0;
      demand.set(request.type, item);
    }
  }
  return demand;
}

function releaseSeconds(job: QueueJob, nowMs: number): number | null {
  const end = job.end_time ? Date.parse(job.end_time) : Number.NaN;
  if (Number.isFinite(end) && end > nowMs) return Math.round((end - nowMs) / 1000);
  if (job.time_limit_seconds !== null && job.elapsed_seconds !== null) return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
  return null;
}

function requests(job: QueueJob): { type: string; count: number }[] {
  if (job.gpus.length) return job.gpus.map((gpu) => ({ type: gpu.type, count: gpu.count }));
  return [{ type: "generic", count: job.gpu_count }];
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function toneFor(seconds: number | null): GpuLeaseTone {
  if (seconds === null) return "opaque";
  return seconds <= 2 * 3600 ? "returning" : "holding";
}

function compareRows(left: GpuLeaseRow, right: GpuLeaseRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.queuedBehind - left.queuedBehind || left.remaining.localeCompare(right.remaining);
}

function toneRank(tone: GpuLeaseTone): number {
  return { holding: 0, returning: 1, opaque: 2 }[tone];
}

function probe(alias: string, jobId: string, type: string): string {
  const family = type.replace(/'/g, "'\\''");
  return `ssh ${alias} 'squeue -j ${jobId} -o "%i|%j|%u|%T|%M|%l|%b|%R|%N"; scontrol show job -dd ${jobId} | sed -n "1,140p"; squeue -t PD -O JobID:12,Name:24,UserName:16,State:12,Reason:28,TresPerNode:24,EndTime:22 | grep -i -- "${family}" || true'`;
}
