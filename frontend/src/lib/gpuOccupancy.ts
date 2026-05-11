import type { NodeGpuInventory, NodeResource, QueueJob } from "../types";

export type GpuOccupancyCell = {
  id: string;
  state: "free" | "used" | "blocked";
  label: string;
  detail: string;
};

export type GpuOccupancyRow = {
  id: string;
  node: string;
  family: string;
  summary: string;
  detail: string;
  tone: "calm" | "mixed" | "busy" | "blocked";
  cells: GpuOccupancyCell[];
  command: string;
};

export type GpuOccupancy = {
  label: string;
  headline: string;
  rows: GpuOccupancyRow[];
};

export function buildGpuOccupancy(nodes: NodeResource[], jobs: QueueJob[], alias: string): GpuOccupancy {
  const gpuNodes = nodes.filter((node) => node.gpu_total > 0);
  const rows = gpuNodes.flatMap((node) => node.gres.map((gpu) => rowFor(node, gpu, jobs, alias)));
  const visible = gpuNodes.reduce((sum, node) => sum + node.gpu_total, 0);
  const schedulable = gpuNodes.filter((node) => node.is_available).reduce((sum, node) => sum + node.gpu_free, 0);
  const blocked = gpuNodes.filter((node) => !node.is_available).reduce((sum, node) => sum + node.gpu_total, 0);
  const pending = jobs.filter((job) => job.state === "PENDING").reduce((sum, job) => sum + job.gpu_count, 0);
  return {
    label: `${schedulable} free / ${visible} visible`,
    headline: headlineFor(pending, schedulable, blocked),
    rows
  };
}

function rowFor(node: NodeResource, gpu: NodeGpuInventory, jobs: QueueJob[], alias: string): GpuOccupancyRow {
  const running = jobs.filter((job) => job.state === "RUNNING" && job.nodes.includes(node.name));
  const blocked = !node.is_available;
  const stateLabel = node.state_flags[0] ?? node.state;
  const summary = blocked ? `${gpu.total} blocked by ${stateLabel}` : `${gpu.used} used / ${gpu.free} free`;
  return {
    id: `${node.name}-${gpu.type}`,
    node: node.name,
    family: gpu.type,
    summary,
    detail: detailFor(node, gpu, running),
    tone: blocked ? "blocked" : gpu.free === 0 ? "busy" : gpu.used > 0 ? "mixed" : "calm",
    cells: cellsFor(node, gpu, running),
    command: `ssh ${alias} 'scontrol show node ${node.name}; squeue -w ${node.name} -o "%i|%j|%u|%t|%M|%l|%b|%R"'`
  };
}

function cellsFor(node: NodeResource, gpu: NodeGpuInventory, jobs: QueueJob[]): GpuOccupancyCell[] {
  const jobCells = jobs.flatMap((job) => Array.from({ length: Math.max(1, job.gpu_count) }, () => job));
  return Array.from({ length: Math.max(gpu.total, 1) }, (_item, index) => {
    const id = `${node.name}-${gpu.type}-${index}`;
    if (!node.is_available) {
      return { id, state: "blocked", label: `${gpu.type}-${index + 1}`, detail: node.reason ?? node.state };
    }
    if (index < gpu.used) {
      const job = jobCells[index];
      return { id, state: "used", label: `${gpu.type}-${index + 1}`, detail: job ? `${job.name ?? job.job_id} / ${job.user}` : "allocated" };
    }
    return { id, state: "free", label: `${gpu.type}-${index + 1}`, detail: "free" };
  });
}

function detailFor(node: NodeResource, gpu: NodeGpuInventory, jobs: QueueJob[]): string {
  if (!node.is_available) return node.reason ?? `${node.state} keeps this node out of scheduler fit.`;
  const visible = jobs.length ? jobs.map((job) => `${job.name ?? job.job_id} / ${job.gpu_count || 1} GPU`).join(", ") : "no visible running GPU jobs";
  return `${visible}; ${gpu.free} GPU${gpu.free === 1 ? "" : "s"} free on this node.`;
}

function headlineFor(pending: number, schedulable: number, blocked: number): string {
  if (pending > schedulable) {
    return `${pending} pending GPU requests are competing for ${schedulable} schedulable GPUs; ${blocked} GPUs are tied to unavailable nodes.`;
  }
  if (blocked) return `${schedulable} schedulable GPUs are visible; ${blocked} GPUs are tied to unavailable nodes.`;
  return `${schedulable} schedulable GPUs are visible across the current GPU node snapshot.`;
}
