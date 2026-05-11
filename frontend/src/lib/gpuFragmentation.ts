import type { GpuPool, NodeResource, QueueJob } from "../types";

export type GpuFragmentTone = "fit" | "gated" | "fragmented" | "scarce" | "idle";

export type GpuFragmentRow = {
  type: string;
  tone: GpuFragmentTone;
  usable: number;
  largestNode: number;
  widestPending: number;
  pendingGpus: number;
  fitNodes: number;
  activeNodes: number;
  gatedGpus: number;
  nodeFree: { name: string; free: number }[];
  signal: string;
  action: string;
};

export type GpuFragmentationLens = {
  label: string;
  headline: string;
  rows: GpuFragmentRow[];
};

type PendingDemand = {
  total: number;
  widest: number;
  gated: number;
  gatedWidest: number;
};

type NodeFit = {
  name: string;
  free: number;
  available: boolean;
};

export function buildGpuFragmentationLens(
  nodes: NodeResource[],
  pools: GpuPool[],
  jobs: QueueJob[]
): GpuFragmentationLens {
  const types = Array.from(new Set([...pools.map((pool) => pool.type), ...nodes.flatMap((node) => node.gpu_types), ...jobs.flatMap(jobTypes)])).sort();
  const rows = types.map((type) => rowFor(type, nodes, pools.find((pool) => pool.type === type), jobs)).filter(visibleRow).sort(compareRows);
  return {
    label: labelFor(rows),
    headline: headlineFor(rows),
    rows
  };
}

function rowFor(type: string, nodes: NodeResource[], pool: GpuPool | undefined, jobs: QueueJob[]): GpuFragmentRow {
  const fits = nodeFits(type, nodes);
  const available = fits.filter((fit) => fit.available);
  const demand = pendingDemand(type, jobs);
  const usable = pool?.usable ?? available.reduce((sum, fit) => sum + fit.free, 0);
  const largestNode = Math.max(0, ...available.map((fit) => fit.free));
  const fitNodes = demand.widest ? available.filter((fit) => fit.free >= demand.widest).length : available.filter((fit) => fit.free > 0).length;
  const tone = toneFor(demand, usable, largestNode);
  const row = {
    type,
    tone,
    usable,
    largestNode,
    widestPending: demand.widest,
    pendingGpus: demand.total,
    fitNodes,
    activeNodes: available.length,
    gatedGpus: demand.gated,
    nodeFree: available.sort((left, right) => right.free - left.free || left.name.localeCompare(right.name)).slice(0, 5),
    signal: "",
    action: ""
  };
  return { ...row, signal: signalFor(row), action: actionFor(row) };
}

function nodeFits(type: string, nodes: NodeResource[]): NodeFit[] {
  return nodes
    .map((node) => {
      const gpu = node.gres.find((item) => item.type === type);
      return gpu ? { name: node.name, free: gpu.free, available: node.is_available } : null;
    })
    .filter((item): item is NodeFit => Boolean(item));
}

function pendingDemand(type: string, jobs: QueueJob[]): PendingDemand {
  return jobs.filter((job) => job.state === "PENDING").reduce(
    (demand, job) => {
      const count = requestCount(job, type);
      if (!count) return demand;
      const gated = isGated(job);
      return {
        total: demand.total + count,
        widest: Math.max(demand.widest, count),
        gated: demand.gated + (gated ? count : 0),
        gatedWidest: Math.max(demand.gatedWidest, gated ? count : 0)
      };
    },
    { total: 0, widest: 0, gated: 0, gatedWidest: 0 }
  );
}

function toneFor(demand: PendingDemand, usable: number, largestNode: number): GpuFragmentTone {
  if (!demand.total) return usable ? "idle" : "scarce";
  if (demand.gatedWidest === demand.widest && demand.gatedWidest > 0) return "gated";
  if (demand.widest > usable) return "scarce";
  if (demand.widest > largestNode) return "fragmented";
  return "fit";
}

function signalFor(row: Omit<GpuFragmentRow, "signal" | "action">): string {
  if (row.tone === "gated") {
    return `${row.type} widest pending request is gated before placement; max node-level fit is ${row.largestNode}.`;
  }
  if (row.tone === "fragmented") {
    return `${row.usable} ${row.type} GPU(s) are free, but no visible node can fit the ${row.widestPending}x request.`;
  }
  if (row.tone === "scarce" && row.pendingGpus) {
    return `${row.widestPending}x ${row.type} demand exceeds ${row.usable} usable GPU(s) in visible nodes.`;
  }
  if (row.tone === "fit") {
    return `${row.widestPending}x ${row.type} demand can fit ${row.fitNodes} visible node(s) right now.`;
  }
  if (row.usable) return `${row.usable} ${row.type} GPU(s) are usable with no visible pending demand.`;
  return `No usable ${row.type} GPU topology is visible.`;
}

function actionFor(row: Omit<GpuFragmentRow, "signal" | "action">): string {
  if (row.tone === "gated") return "Clear dependency, hold, or begin-time fields before changing GPU width.";
  if (row.tone === "fragmented") return "Try a narrower GPU shape or wait for a fuller node release.";
  if (row.tone === "scarce") return "Use smaller GPU width or watch the release radar for turnover.";
  if (row.tone === "fit") return "Keep the request shape; placement is plausible from visible topology.";
  return "Use this family when the request can tolerate its partition and memory shape.";
}

function labelFor(rows: GpuFragmentRow[]): string {
  const fragmented = rows.filter((row) => row.tone === "fragmented").length;
  const gated = rows.filter((row) => row.tone === "gated").length;
  return rows.length ? `${fragmented} fragmented / ${gated} gated` : "no GPU topology";
}

function headlineFor(rows: GpuFragmentRow[]): string {
  if (!rows.length) return "No GPU topology is visible in this snapshot.";
  if (rows.some((row) => row.tone === "fragmented")) return "Some wide GPU work is blocked by node-level shape, not total count.";
  if (rows.some((row) => row.tone === "gated")) return "Wide GPU fit is currently hidden behind scheduler gates.";
  if (rows.some((row) => row.tone === "scarce" && row.pendingGpus)) return "Pending GPU width exceeds visible usable topology.";
  return "Visible GPU demand fits the current node-level topology.";
}

function visibleRow(row: GpuFragmentRow): boolean {
  return row.usable > 0 || row.pendingGpus > 0 || row.largestNode > 0;
}

function compareRows(left: GpuFragmentRow, right: GpuFragmentRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.pendingGpus - left.pendingGpus || right.usable - left.usable || left.type.localeCompare(right.type);
}

function toneRank(tone: GpuFragmentTone): number {
  return { idle: 0, fit: 1, gated: 2, fragmented: 3, scarce: 4 }[tone];
}

function requestCount(job: QueueJob, type: string): number {
  if (job.gpus.length) return job.gpus.filter((gpu) => gpu.type === type).reduce((sum, gpu) => sum + gpu.count, 0);
  return type === "generic" ? job.gpu_count : 0;
}

function jobTypes(job: QueueJob): string[] {
  if (job.gpus.length) return job.gpus.map((gpu) => gpu.type);
  return job.gpu_count > 0 ? ["generic"] : [];
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}
