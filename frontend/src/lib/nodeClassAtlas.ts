import { formatMemory, formatNumber } from "../api";
import type { NodeResource } from "../types";

export type NodeClassTone = "calm" | "busy" | "hot";

export type NodeClassProfile = {
  id: string;
  label: string;
  nodes: number;
  available: number;
  freeGpu: number;
  totalGpu: number;
  maxFreeGpu: number;
  idleCpu: number;
  totalCpu: number;
  freeMemoryMb: number;
  partitions: string[];
  bestFor: string;
  message: string;
  tone: NodeClassTone;
};

export function buildNodeClassAtlas(nodes: NodeResource[]): NodeClassProfile[] {
  const groups = new Map<string, NodeResource[]>();
  for (const node of nodes) {
    const key = classKey(node);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  return Array.from(groups.entries())
    .map(([label, rows]) => profile(label, rows))
    .sort(compareProfiles);
}

function profile(label: string, nodes: NodeResource[]): NodeClassProfile {
  const availableNodes = nodes.filter((node) => node.is_available);
  const freeGpu = sum(availableNodes.map((node) => node.gpu_free));
  const totalGpu = sum(nodes.map((node) => node.gpu_total));
  const maxFreeGpu = Math.max(0, ...availableNodes.map((node) => node.gpu_free));
  const idleCpu = sum(availableNodes.map((node) => node.cpus_idle));
  const totalCpu = sum(nodes.map((node) => node.cpus_total));
  const freeMemoryMb = sum(availableNodes.map((node) => node.memory_free_mb ?? 0));
  const representative = nodes[0];
  const unavailable = nodes.length - availableNodes.length;
  return {
    id: label,
    label,
    nodes: nodes.length,
    available: availableNodes.length,
    freeGpu,
    totalGpu,
    maxFreeGpu,
    idleCpu,
    totalCpu,
    freeMemoryMb,
    partitions: Array.from(new Set(nodes.flatMap((node) => node.partitions))).sort(),
    bestFor: bestFor(representative),
    message: classMessage(representative, nodes.length, unavailable, freeGpu, maxFreeGpu, idleCpu, freeMemoryMb),
    tone: toneFor(nodes.length, unavailable, freeGpu, totalGpu, idleCpu)
  };
}

function classKey(node: NodeResource): string {
  const memory = formatMemory(node.memory_total_mb);
  if (!node.gres.length) return `CPU / ${node.cpus_total} CPU / ${memory}`;
  const gpu = node.gres
    .map((item) => `${item.total}x ${item.type}`)
    .sort()
    .join(" + ");
  return `${gpu} / ${node.cpus_total} CPU / ${memory}`;
}

function bestFor(node: NodeResource): string {
  const gpuTypes = node.gpu_types.join(" ").toLowerCase();
  const memoryGb = node.memory_total_mb / 1024;
  if (!node.gpu_total && memoryGb >= 512) return "memory-heavy CPU";
  if (!node.gpu_total) return "CPU arrays";
  if (/h200|h100|a100/.test(gpuTypes) && node.gpu_total >= 4) return "large-model training";
  if (/l4|a10/.test(gpuTypes)) return "inference and notebooks";
  if (node.gpu_total >= 4) return "wide GPU experiments";
  return "single-GPU work";
}

function classMessage(
  node: NodeResource,
  nodes: number,
  unavailable: number,
  freeGpu: number,
  maxFreeGpu: number,
  idleCpu: number,
  freeMemoryMb: number
): string {
  if (unavailable) return `${unavailable}/${nodes} node(s) in this class are drained, down, or otherwise unavailable.`;
  if (node.gpu_total > 0 && maxFreeGpu >= node.gpu_total) return `A full ${node.gpu_total} GPU node is visible for contiguous work.`;
  if (node.gpu_total > 0 && freeGpu > 0) return `${freeGpu} GPU free across the class, but the largest visible node fit is ${maxFreeGpu}.`;
  if (node.gpu_total > 0) return "No usable GPU in this class is free right now; watch turnover before targeting it.";
  return `${formatNumber(idleCpu)} idle CPU and ${formatMemory(freeMemoryMb)} free memory are visible for CPU jobs.`;
}

function toneFor(nodes: number, unavailable: number, freeGpu: number, totalGpu: number, idleCpu: number): NodeClassTone {
  if (unavailable / Math.max(nodes, 1) >= 0.5) return "hot";
  if (totalGpu > 0 && freeGpu === 0) return "hot";
  if (totalGpu > 0 && freeGpu / Math.max(totalGpu, 1) < 0.35) return "busy";
  if (totalGpu === 0 && idleCpu < 32) return "busy";
  return "calm";
}

function compareProfiles(left: NodeClassProfile, right: NodeClassProfile): number {
  return right.totalGpu - left.totalGpu || right.freeGpu - left.freeGpu || right.available - left.available || left.label.localeCompare(right.label);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
