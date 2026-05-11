import { formatMemory } from "../api";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";

type Shape = {
  label: string;
  cpus: number;
  memoryMb: number;
  gpus: number;
};

export type BackfillOpportunity = {
  label: string;
  request: string;
  partition: string;
  fitNodes: number;
  bestNode: string;
  largestGpu: number;
  severity: "info" | "warning" | "critical";
  advice: string;
};

const SHAPES: Shape[] = [
  { label: "CPU probe", cpus: 4, memoryMb: 16 * 1024, gpus: 0 },
  { label: "Notebook GPU", cpus: 4, memoryMb: 32 * 1024, gpus: 1 },
  { label: "Single GPU train", cpus: 8, memoryMb: 64 * 1024, gpus: 1 },
  { label: "Two GPU train", cpus: 16, memoryMb: 128 * 1024, gpus: 2 },
  { label: "Wide GPU", cpus: 32, memoryMb: 256 * 1024, gpus: 4 }
];

export function buildBackfillOpportunities(
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  jobs: QueueJob[]
): BackfillOpportunity[] {
  const pending = jobs.filter((job) => job.state === "PENDING");
  return SHAPES.map((shape) => opportunityFor(shape, nodes, partitions, pending))
    .filter((item): item is BackfillOpportunity => item !== null)
    .sort((left, right) => severityRank(left) - severityRank(right) || right.fitNodes - left.fitNodes);
}

function opportunityFor(
  shape: Shape,
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  pending: QueueJob[]
): BackfillOpportunity | null {
  const candidates = partitions
    .map((partition) => fitForPartition(shape, partition.name, nodes))
    .sort((left, right) => right.fitNodes - left.fitNodes || right.largestGpu - left.largestGpu);
  const best = candidates[0];
  if (!best) return null;
  const severity = best.fitNodes ? "info" : shape.gpus >= 2 ? "critical" : "warning";
  return {
    label: shape.label,
    request: `${shape.cpus} CPU / ${formatMemory(shape.memoryMb)} / ${shape.gpus} GPU`,
    partition: best.partition,
    fitNodes: best.fitNodes,
    bestNode: best.bestNode,
    largestGpu: best.largestGpu,
    severity,
    advice: advice(shape, best, pending)
  };
}

function fitForPartition(shape: Shape, partition: string, nodes: NodeResource[]) {
  const candidates = nodes.filter((node) => node.is_available && node.partitions.includes(partition));
  const fits = candidates.filter((node) => fitsShape(node, shape));
  const ranked = fits.slice().sort((left, right) => right.gpu_free - left.gpu_free || right.cpus_idle - left.cpus_idle);
  return {
    partition,
    fitNodes: fits.length,
    bestNode: ranked[0]?.name ?? "none",
    largestGpu: Math.max(0, ...candidates.map((node) => node.gpu_free))
  };
}

function fitsShape(node: NodeResource, shape: Shape): boolean {
  const freeMem = node.memory_free_mb ?? node.memory_total_mb;
  return node.cpus_idle >= shape.cpus && freeMem >= shape.memoryMb && node.gpu_free >= shape.gpus;
}

function advice(shape: Shape, fit: ReturnType<typeof fitForPartition>, pending: QueueJob[]): string {
  if (fit.fitNodes > 0 && shape.gpus === 0) return `${shape.label} can backfill on ${fit.fitNodes} node(s) right now.`;
  if (fit.fitNodes > 0) return `${shape.label} fits now; compare this shape against larger pending GPU requests before waiting.`;
  const blocked = pending.filter((job) => job.gpu_count >= shape.gpus && shape.gpus > 0).length;
  if (blocked) return `${blocked} pending GPU job(s) compete above this shape; reduce GPUs or walltime to chase backfill.`;
  if (shape.gpus > fit.largestGpu) return `No node exposes ${shape.gpus} free GPU(s); split the run or use an array.`;
  return "Capacity is visible on paper, but CPU, memory, or partition fit blocks this shape.";
}

function severityRank(item: BackfillOpportunity): number {
  return { info: 0, warning: 1, critical: 2 }[item.severity];
}
