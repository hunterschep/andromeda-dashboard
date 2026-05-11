import { formatNumber } from "../api";
import { stateText } from "./dashboard";
import type { NodeResource, QueueJob } from "../types";

export type NodeNeighborhoodTone = "clear" | "busy" | "degraded";

export type NodeNeighborhood = {
  id: string;
  label: string;
  tone: NodeNeighborhoodTone;
  nodes: number;
  available: number;
  unavailable: number;
  idleCpu: number;
  totalCpu: number;
  freeGpu: number;
  totalGpu: number;
  blockedGpu: number;
  blockedCpu: number;
  pendingGpu: number;
  range: string;
  partitions: string[];
  gpuTypes: string[];
  message: string;
  command: string;
};

export type NodeNeighborhoodMap = {
  total: number;
  degraded: number;
  label: string;
  headline: string;
  rows: NodeNeighborhood[];
};

export function buildNodeNeighborhoodMap(
  nodes: NodeResource[],
  jobs: QueueJob[],
  alias: string
): NodeNeighborhoodMap {
  const groups = new Map<string, NodeResource[]>();
  for (const node of nodes) groups.set(groupKey(node.name), [...(groups.get(groupKey(node.name)) ?? []), node]);
  const rows = Array.from(groups.entries()).map(([key, group]) => rowFor(key, group, jobs, alias)).sort(compareRows);
  const degraded = rows.filter((row) => row.tone === "degraded").length;
  return {
    total: rows.length,
    degraded,
    label: rows.length ? `${rows.length} neighborhoods / ${degraded} degraded` : "no neighborhoods",
    headline: headlineFor(rows),
    rows
  };
}

function rowFor(key: string, nodes: NodeResource[], jobs: QueueJob[], alias: string): NodeNeighborhood {
  const sorted = nodes.slice().sort((left, right) => left.name.localeCompare(right.name));
  const unavailableNodes = sorted.filter(isUnavailable);
  const availableNodes = sorted.filter((node) => !isUnavailable(node));
  const gpuTypes = Array.from(new Set(sorted.flatMap((node) => node.gpu_types))).sort();
  const blockedGpu = unavailableNodes.reduce((sum, node) => sum + node.gpu_total, 0);
  const freeGpu = availableNodes.reduce((sum, node) => sum + node.gpu_free, 0);
  const pendingGpu = pendingGpuFor(gpuTypes, jobs);
  const row = {
    id: key,
    label: key,
    tone: toneFor(unavailableNodes.length, sorted.length, freeGpu, pendingGpu),
    nodes: sorted.length,
    available: availableNodes.length,
    unavailable: unavailableNodes.length,
    idleCpu: availableNodes.reduce((sum, node) => sum + node.cpus_idle, 0),
    totalCpu: sorted.reduce((sum, node) => sum + node.cpus_total, 0),
    freeGpu,
    totalGpu: sorted.reduce((sum, node) => sum + node.gpu_total, 0),
    blockedGpu,
    blockedCpu: unavailableNodes.reduce((sum, node) => sum + node.cpus_total, 0),
    pendingGpu,
    range: rangeText(sorted),
    partitions: Array.from(new Set(sorted.flatMap((node) => node.partitions))).sort(),
    gpuTypes,
    message: "",
    command: commandFor(alias, sorted)
  };
  return { ...row, message: messageFor(row) };
}

function groupKey(name: string): string {
  const prefix = name.match(/^[A-Za-z_-]+/)?.[0];
  return prefix?.replace(/[-_]+$/, "") || name.slice(0, 3) || "unknown";
}

function pendingGpuFor(types: string[], jobs: QueueJob[]): number {
  if (!types.length) return 0;
  const typeSet = new Set(types);
  return jobs
    .filter((job) => job.state === "PENDING")
    .flatMap((job) => job.gpus)
    .filter((gpu) => typeSet.has(gpu.type))
    .reduce((sum, gpu) => sum + gpu.count, 0);
}

function toneFor(unavailable: number, total: number, freeGpu: number, pendingGpu: number): NodeNeighborhoodTone {
  if (unavailable > 0) return "degraded";
  if (pendingGpu > freeGpu || unavailable / Math.max(total, 1) >= 0.25) return "busy";
  return "clear";
}

function messageFor(row: Omit<NodeNeighborhood, "message">): string {
  if (row.unavailable) {
    return `${row.label} has ${row.unavailable} unavailable node${row.unavailable === 1 ? "" : "s"} removing ${row.blockedGpu} GPU / ${formatNumber(row.blockedCpu)} CPU while ${row.pendingGpu} pending GPU request(s) match this neighborhood.`;
  }
  if (row.pendingGpu > row.freeGpu) return `${row.label} has ${row.freeGpu} free GPU against ${row.pendingGpu} pending GPU request(s) for its hardware family.`;
  if (row.freeGpu) return `${row.label} has ${row.freeGpu} free GPU across ${row.available}/${row.nodes} available nodes.`;
  return `${row.label} is CPU-only or has no free GPU; ${formatNumber(row.idleCpu)} idle CPU remain visible.`;
}

function headlineFor(rows: NodeNeighborhood[]): string {
  if (!rows.length) return "No node inventory is visible for neighborhood analysis.";
  const top = rows[0];
  if (top.tone === "degraded") {
    return `${top.label} is the hottest neighborhood: ${top.unavailable} unavailable node${top.unavailable === 1 ? "" : "s"}, ${top.blockedGpu} blocked GPU, ${top.freeGpu} free GPU.`;
  }
  if (top.tone === "busy") return `${top.label} has the tightest visible hardware neighborhood fit.`;
  return `${rows.length} hardware neighborhood${rows.length === 1 ? "" : "s"} are visible without localized capacity loss.`;
}

function rangeText(nodes: NodeResource[]): string {
  if (!nodes.length) return "n/a";
  if (nodes.length === 1) return nodes[0].name;
  return `${nodes[0].name}-${nodes[nodes.length - 1].name}`;
}

function commandFor(alias: string, nodes: NodeResource[]): string {
  const names = nodes.map((node) => node.name).slice(0, 40).join(",");
  return `ssh ${alias} 'sinfo -N -n ${names} -o "%N|%T|%C|%G|%P"; squeue -w ${names} -o "%i|%j|%T|%C|%b|%N"'`;
}

function isUnavailable(node: NodeResource): boolean {
  const text = stateText(node).toLowerCase();
  return !node.is_available || Boolean(node.reason) || /down|drain|fail|maint|no_respond|power/.test(text);
}

function compareRows(left: NodeNeighborhood, right: NodeNeighborhood): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.blockedGpu - left.blockedGpu || right.pendingGpu - left.pendingGpu || left.label.localeCompare(right.label);
}

function toneRank(tone: NodeNeighborhoodTone): number {
  return { clear: 0, busy: 1, degraded: 2 }[tone];
}
