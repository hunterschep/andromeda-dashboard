import { formatNumber } from "../api";
import { stateText } from "./dashboard";
import type { NodeResource, QueueJob } from "../types";

export type CapacityLossTone = "clear" | "watch" | "critical";

export type CapacityLossRow = {
  key: string;
  tone: CapacityLossTone;
  nodes: string;
  value: string;
  detail: string;
};

export type CapacityLossLedger = {
  tone: CapacityLossTone;
  label: string;
  headline: string;
  command: string;
  rows: CapacityLossRow[];
};

export function buildCapacityLossLedger(nodes: NodeResource[], jobs: QueueJob[], alias: string): CapacityLossLedger {
  const unavailable = nodes.filter(isUnavailable);
  const totalCpu = nodes.reduce((sum, node) => sum + node.cpus_total, 0);
  const totalGpu = nodes.reduce((sum, node) => sum + node.gpu_total, 0);
  const lostCpu = unavailable.reduce((sum, node) => sum + node.cpus_total, 0);
  const lostGpu = unavailable.reduce((sum, node) => sum + node.gpu_total, 0);
  const rows = groupedLoss(unavailable, nodes, jobs);
  return {
    tone: lostGpu || lostCpu ? (lostGpu ? "critical" : "watch") : "clear",
    label: lostGpu || lostCpu ? `${lostGpu} GPU / ${formatNumber(lostCpu)} CPU offline` : "capacity clear",
    headline: lostGpu || lostCpu
      ? `${unavailable.length} node${unavailable.length === 1 ? "" : "s"} ${unavailable.length === 1 ? "removes" : "remove"} ${formatNumber(lostCpu)} CPU and ${lostGpu} GPU from visible capacity.`
      : "No drained, down, or reason-tagged nodes are removing visible capacity.",
    command: inspectCommand(alias),
    rows
  };
}

function groupedLoss(unavailable: NodeResource[], allNodes: NodeResource[], jobs: QueueJob[]): CapacityLossRow[] {
  const groups = new Map<string, NodeResource[]>();
  for (const node of unavailable) {
    const key = node.reason?.trim() || stateText(node);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  return Array.from(groups.entries()).map(([key, group]) => rowFor(key, group, allNodes, jobs));
}

function rowFor(key: string, nodes: NodeResource[], allNodes: NodeResource[], jobs: QueueJob[]): CapacityLossRow {
  const lostCpu = nodes.reduce((sum, node) => sum + node.cpus_total, 0);
  const lostGpu = nodes.reduce((sum, node) => sum + node.gpu_total, 0);
  const lostTypes = new Set(nodes.flatMap((node) => node.gpu_types));
  const pendingGpu = jobs
    .filter((job) => job.state === "PENDING")
    .flatMap((job) => job.gpus)
    .filter((gpu) => lostTypes.has(gpu.type))
    .reduce((sum, gpu) => sum + gpu.count, 0);
  const partitions = Array.from(new Set(nodes.flatMap((node) => node.partitions))).sort();
  return {
    key,
    tone: lostGpu ? "critical" : "watch",
    nodes: nodes.map((node) => node.name).slice(0, 4).join(", "),
    value: `${lostGpu} GPU / ${formatNumber(lostCpu)} CPU`,
    detail: detailFor({ lostGpu, totalGpu: allNodes.reduce((sum, node) => sum + node.gpu_total, 0), pendingGpu, partitions })
  };
}

function detailFor({
  lostGpu,
  totalGpu,
  pendingGpu,
  partitions
}: {
  lostGpu: number;
  totalGpu: number;
  pendingGpu: number;
  partitions: string[];
}): string {
  const gpuShare = totalGpu && lostGpu ? `${Math.round((lostGpu / totalGpu) * 100)}% visible GPU capacity removed` : "CPU-only capacity removed";
  const demand = pendingGpu ? `${pendingGpu} pending GPU demand maps to this lost class.` : "No pending GPU demand maps directly to this loss.";
  return `${gpuShare} across ${partitions.join(", ") || "unassigned"}; ${demand}`;
}

function isUnavailable(node: NodeResource): boolean {
  const text = stateText(node).toLowerCase();
  return !node.is_available || Boolean(node.reason) || /down|drain|fail|maint|no_respond|power/.test(text);
}

function inspectCommand(alias: string): string {
  return `ssh ${alias} 'sinfo -R; scontrol show nodes --json | jq ".nodes[] | {name:.name,state:.state,reason:.reason,gres:.gres,partitions:.partitions}"'`;
}
