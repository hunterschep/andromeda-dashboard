import { formatMemory } from "../api";
import type { PartitionSummary, QueueJob } from "../types";

export type PartitionSaturationRow = {
  name: string;
  tone: "open" | "watch" | "hot";
  headline: string;
  cpuBusy: number;
  gpuBusy: number;
  pendingCpu: number;
  pendingGpu: number;
  gatedGpu: number;
  queue: string;
  memory: string;
  command: string;
};

export type PartitionSaturation = {
  label: string;
  headline: string;
  rows: PartitionSaturationRow[];
};

type Demand = {
  running: number;
  pending: number;
  pendingCpu: number;
  pendingGpu: number;
  gatedGpu: number;
};

export function buildPartitionSaturation(
  partitions: PartitionSummary[],
  jobs: QueueJob[],
  alias: string
): PartitionSaturation {
  const demand = demandByPartition(jobs);
  const rows = partitions.map((partition) => rowFor(partition, demand.get(partition.name), alias)).sort(compareRows);
  const hot = rows.filter((row) => row.tone === "hot").length;
  const watch = rows.filter((row) => row.tone === "watch").length;
  return {
    label: rows.length ? `${hot} hot / ${watch} watch` : "no lanes",
    headline: headlineFor(rows),
    rows
  };
}

function rowFor(partition: PartitionSummary, demand: Demand | undefined, alias: string): PartitionSaturationRow {
  const visible = demand ?? { running: 0, pending: 0, pendingCpu: 0, pendingGpu: 0, gatedGpu: 0 };
  const cpuBusy = percentBusy(partition.cpus_total, partition.cpus_idle);
  const gpuBusy = percentBusy(partition.gpu_total, partition.gpu_free);
  return {
    name: partition.name,
    tone: toneFor(partition, visible, cpuBusy, gpuBusy),
    headline: rowHeadline(partition, visible, cpuBusy, gpuBusy),
    cpuBusy,
    gpuBusy,
    pendingCpu: visible.pendingCpu,
    pendingGpu: visible.pendingGpu,
    gatedGpu: visible.gatedGpu,
    queue: `${visible.running} run / ${visible.pending} pend`,
    memory: formatMemory(partition.memory_free_mb),
    command: `ssh ${alias} 'sinfo -p ${partition.name} -Nel -o "%N|%t|%C|%m|%G|%E"; squeue -p ${partition.name} -o "%i|%j|%u|%t|%M|%l|%C|%b|%R"'`
  };
}

function demandByPartition(jobs: QueueJob[]): Map<string, Demand> {
  const groups = new Map<string, Demand>();
  for (const job of jobs) {
    if (!job.partition) continue;
    const current = groups.get(job.partition) ?? { running: 0, pending: 0, pendingCpu: 0, pendingGpu: 0, gatedGpu: 0 };
    if (job.state === "RUNNING") current.running += 1;
    if (job.state === "PENDING") {
      current.pending += 1;
      current.pendingCpu += job.cpus;
      current.pendingGpu += job.gpu_count;
      if (isGated(job)) current.gatedGpu += job.gpu_count;
    }
    groups.set(job.partition, current);
  }
  return groups;
}

function rowHeadline(partition: PartitionSummary, demand: Demand, cpuBusy: number, gpuBusy: number): string {
  if (demand.gatedGpu > 0) {
    return `${partition.name} shows ${partition.gpu_free} free GPU, but ${demand.gatedGpu} GPU are hidden behind scheduler gates.`;
  }
  if (demand.pendingCpu >= partition.cpus_idle && demand.pendingCpu > 0) {
    return `${partition.name} has enough idle CPU for one full-width pending wave, then it is saturated.`;
  }
  if (partition.gpu_total > 0) return `${partition.name} is ${gpuBusy}% GPU busy and ${cpuBusy}% CPU busy.`;
  return `${partition.name} is ${cpuBusy}% CPU busy with ${partition.idle_nodes} idle node(s).`;
}

function toneFor(
  partition: PartitionSummary,
  demand: Demand,
  cpuBusy: number,
  gpuBusy: number
): PartitionSaturationRow["tone"] {
  if (demand.pendingCpu >= partition.cpus_idle && demand.pendingCpu > 0) return "hot";
  if (demand.pendingGpu > partition.gpu_free && demand.gatedGpu === 0) return "hot";
  if (cpuBusy >= 70 || gpuBusy >= 70 || partition.down_nodes > 0) return "watch";
  if (demand.pending > 0 || demand.gatedGpu > 0) return "watch";
  return "open";
}

function headlineFor(rows: PartitionSaturationRow[]): string {
  const gated = rows.find((row) => row.gatedGpu > 0);
  if (gated) return `${gated.name} has free GPU on paper while gated demand waits to re-enter the lane.`;
  const hot = rows.find((row) => row.tone === "hot");
  if (hot) return `${hot.name} is the tightest visible partition lane right now.`;
  return "No partition lane is visibly saturated for matching request shapes.";
}

function percentBusy(total: number, free: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - free / total) * 100)));
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function compareRows(left: PartitionSaturationRow, right: PartitionSaturationRow): number {
  return (
    toneRank(right.tone) - toneRank(left.tone) ||
    right.pendingGpu - left.pendingGpu ||
    right.pendingCpu - left.pendingCpu ||
    left.name.localeCompare(right.name)
  );
}

function toneRank(tone: PartitionSaturationRow["tone"]): number {
  return { open: 0, watch: 1, hot: 2 }[tone];
}
