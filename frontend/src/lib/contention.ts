import { formatMemory } from "../api";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";

export type ContentionRow = {
  partition: string;
  pendingJobs: number;
  pendingCpus: number;
  pendingGpus: number;
  pendingMemoryMb: number;
  freeCpus: number;
  freeGpus: number;
  freeMemoryMb: number;
  pressure: number;
  bottleneck: "CPU" | "GPU" | "Memory" | "Open";
  severity: "info" | "warning" | "critical";
  fragmentation: string | null;
  narrative: string;
};

export function buildContentionMap(partitions: PartitionSummary[], nodes: NodeResource[], jobs: QueueJob[]) {
  const pending = jobs.filter((job) => job.state === "PENDING");
  return partitions.map((partition) => analyzePartition(partition, nodes, pending)).sort(compareRows);
}

function analyzePartition(partition: PartitionSummary, nodes: NodeResource[], pending: QueueJob[]): ContentionRow {
  const jobs = pending.filter((job) => job.partition === partition.name);
  const pendingCpus = sum(jobs.map((job) => job.cpus));
  const pendingGpus = sum(jobs.map((job) => job.gpu_count));
  const pendingMemoryMb = sum(jobs.map((job) => job.memory_mb ?? 0));
  const pressures = {
    CPU: ratio(pendingCpus, partition.cpus_idle),
    GPU: pendingGpus ? ratio(pendingGpus, partition.gpu_free) : 0,
    Memory: pendingMemoryMb ? ratio(pendingMemoryMb, partition.memory_free_mb) : 0
  };
  const bottleneck = pickBottleneck(pressures);
  const pressure = Math.round(Math.max(...Object.values(pressures)) * 100);
  const fragmentation = gpuFragmentation(partition, nodes, jobs);
  return {
    partition: partition.name,
    pendingJobs: jobs.length,
    pendingCpus,
    pendingGpus,
    pendingMemoryMb,
    freeCpus: partition.cpus_idle,
    freeGpus: partition.gpu_free,
    freeMemoryMb: partition.memory_free_mb,
    pressure,
    bottleneck: jobs.length ? bottleneck : "Open",
    severity: severity(pressure, fragmentation),
    fragmentation,
    narrative: narrative(partition, jobs.length, bottleneck, pressure, fragmentation)
  };
}

function gpuFragmentation(partition: PartitionSummary, nodes: NodeResource[], jobs: QueueJob[]): string | null {
  const largestAsk = Math.max(0, ...jobs.map((job) => job.gpu_count));
  if (!largestAsk || partition.gpu_free < largestAsk) return null;
  const largestNodeFree = Math.max(
    0,
    ...nodes.filter((node) => node.partitions.includes(partition.name)).map((node) => node.gpu_free)
  );
  if (largestNodeFree >= largestAsk) return null;
  return `GPU fragmentation: ${partition.gpu_free} free total, largest node has ${largestNodeFree}.`;
}

function pickBottleneck(values: Record<"CPU" | "GPU" | "Memory", number>): ContentionRow["bottleneck"] {
  return (Object.entries(values).sort((left, right) => right[1] - left[1])[0]?.[0] as ContentionRow["bottleneck"]) ?? "Open";
}

function severity(pressure: number, fragmentation: string | null): ContentionRow["severity"] {
  if (fragmentation || pressure >= 200) return "critical";
  if (pressure >= 100) return "warning";
  return "info";
}

function narrative(partition: PartitionSummary, jobs: number, bottleneck: ContentionRow["bottleneck"], pressure: number, fragmentation: string | null) {
  if (!jobs) return "No visible pending jobs are targeting this partition.";
  if (fragmentation) return "Total GPU count is misleading because free devices are split across nodes.";
  if (pressure >= 100) return `${bottleneck} demand is at or above visible free capacity.`;
  return `${jobs} pending job(s) fit inside visible ${partition.name} capacity on paper.`;
}

function compareRows(left: ContentionRow, right: ContentionRow): number {
  return right.pressure - left.pressure || right.pendingJobs - left.pendingJobs || left.partition.localeCompare(right.partition);
}

function ratio(needed: number, free: number): number {
  if (needed <= 0) return 0;
  if (free <= 0) return 99;
  return needed / free;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function demandText(row: ContentionRow): string {
  return `${row.pendingCpus} CPU / ${formatMemory(row.pendingMemoryMb)} / ${row.pendingGpus} GPU`;
}

export function capacityText(row: ContentionRow): string {
  return `${row.freeCpus} CPU / ${formatMemory(row.freeMemoryMb)} / ${row.freeGpus} GPU`;
}
