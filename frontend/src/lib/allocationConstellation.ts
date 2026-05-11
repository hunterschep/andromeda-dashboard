import { formatNumber } from "../api";
import { stateText } from "./dashboard";
import type { NodeResource, QueueJob } from "../types";

export type AllocationTone = "open" | "active" | "shadow" | "blocked";

export type AllocationNode = {
  name: string;
  tone: AllocationTone;
  state: string;
  partitions: string;
  activity: number;
  allocatedCpu: number;
  usedGpu: number;
  visibleCpu: number;
  visibleGpu: number;
  hiddenCpu: number;
  hiddenGpu: number;
  jobText: string;
  message: string;
  command: string;
};

export type AllocationConstellation = {
  activeNodes: number;
  openNodes: number;
  hiddenSignals: number;
  visibleJobs: number;
  unplacedJobs: number;
  label: string;
  headline: string;
  command: string;
  nodes: AllocationNode[];
};

export function buildAllocationConstellation(
  nodes: NodeResource[],
  jobs: QueueJob[],
  alias: string
): AllocationConstellation {
  const running = jobs.filter((job) => job.state === "RUNNING");
  const byNode = mapRunningJobs(running);
  const rows = nodes.map((node) => allocationNode(node, byNode.get(node.name) ?? [], alias)).sort(compareNodes);
  const activeNodes = rows.filter((node) => node.tone === "active" || node.tone === "shadow").length;
  const openNodes = rows.filter((node) => node.tone === "open").length;
  const hiddenSignals = rows.filter((node) => node.hiddenCpu > 0 || node.hiddenGpu > 0).length;
  const visibleJobs = running.filter((job) => job.nodes.length).length;
  const unplacedJobs = running.filter((job) => !job.nodes.length).length;
  return {
    activeNodes,
    openNodes,
    hiddenSignals,
    visibleJobs,
    unplacedJobs,
    label: `${activeNodes} active / ${hiddenSignals} hidden signal${hiddenSignals === 1 ? "" : "s"}`,
    headline: headline(activeNodes, openNodes, hiddenSignals, visibleJobs, unplacedJobs),
    command: fleetCommand(alias),
    nodes: rows
  };
}

function allocationNode(node: NodeResource, jobs: QueueJob[], alias: string): AllocationNode {
  const visibleCpu = jobs.reduce((sum, job) => sum + job.cpus, 0);
  const visibleGpu = jobs.reduce((sum, job) => sum + job.gpu_count, 0);
  const hiddenCpu = node.is_available ? Math.max(0, node.cpus_allocated - visibleCpu) : 0;
  const hiddenGpu = node.is_available ? Math.max(0, node.gpu_used - visibleGpu) : 0;
  const tone = toneFor(node, jobs.length, hiddenCpu, hiddenGpu);
  return {
    name: node.name,
    tone,
    state: stateText(node),
    partitions: node.partitions.join(", ") || "unassigned",
    activity: activityFor(node, visibleCpu, visibleGpu),
    allocatedCpu: node.cpus_allocated,
    usedGpu: node.gpu_used,
    visibleCpu,
    visibleGpu,
    hiddenCpu,
    hiddenGpu,
    jobText: jobText(node.name, jobs),
    message: messageFor(node, jobs, visibleCpu, visibleGpu, hiddenCpu, hiddenGpu),
    command: `ssh ${alias} 'scontrol show node ${node.name}; squeue -w ${node.name} -o "%.18i|%.20j|%.12u|%.8P|%.12T|%C|%b|%N"'`
  };
}

function mapRunningJobs(jobs: QueueJob[]): Map<string, QueueJob[]> {
  const byNode = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    for (const node of job.nodes) byNode.set(node, [...(byNode.get(node) ?? []), job]);
  }
  return byNode;
}

function toneFor(node: NodeResource, visibleJobs: number, hiddenCpu: number, hiddenGpu: number): AllocationTone {
  if (!node.is_available) return "blocked";
  if (hiddenCpu > 0 || hiddenGpu > 0) return "shadow";
  if (visibleJobs || node.cpus_allocated > 0 || node.gpu_used > 0) return "active";
  return "open";
}

function activityFor(node: NodeResource, visibleCpu: number, visibleGpu: number): number {
  const cpuLoad = node.cpus_total ? Math.max(node.cpus_allocated, visibleCpu) / node.cpus_total : 0;
  const gpuLoad = node.gpu_total ? Math.max(node.gpu_used, visibleGpu) / node.gpu_total : 0;
  return Math.min(100, Math.round(Math.max(cpuLoad, gpuLoad) * 100));
}

function jobText(nodeName: string, jobs: QueueJob[]): string {
  if (!jobs.length) return `no visible running jobs on ${nodeName}`;
  return jobs
    .map((job) => `${job.name ?? job.job_id} on ${nodeName}`)
    .slice(0, 3)
    .join(", ");
}

function messageFor(
  node: NodeResource,
  jobs: QueueJob[],
  visibleCpu: number,
  visibleGpu: number,
  hiddenCpu: number,
  hiddenGpu: number
): string {
  if (!node.is_available) return `${node.name} is ${stateText(node)}; ${node.reason ?? "Slurm does not expose an operator reason."}`;
  if (hiddenCpu || hiddenGpu) {
    return `${node.name} shows ${formatNumber(node.cpus_allocated)} allocated CPU / ${node.gpu_used} GPU used; visible queue rows explain ${formatNumber(visibleCpu)} CPU / ${visibleGpu} GPU.`;
  }
  if (jobs.length) return `${node.name} is explained by ${jobs.length} visible running job${jobs.length === 1 ? "" : "s"}.`;
  return `${node.name} is visible as open headroom for backfill or new work.`;
}

function headline(
  activeNodes: number,
  openNodes: number,
  hiddenSignals: number,
  visibleJobs: number,
  unplacedJobs: number
): string {
  if (hiddenSignals) {
    return `${hiddenSignals} node${hiddenSignals === 1 ? "" : "s"} ${hiddenSignals === 1 ? "has" : "have"} allocation counters beyond visible jobs; expect filtered users, cache skew, or hidden Slurm rows before assuming idle headroom.`;
  }
  if (unplacedJobs) return `${unplacedJobs} running job${unplacedJobs === 1 ? "" : "s"} lack node placement in the visible queue snapshot.`;
  if (activeNodes) return `${visibleJobs} visible running job${visibleJobs === 1 ? "" : "s"} explain activity across ${activeNodes} active node${activeNodes === 1 ? "" : "s"}.`;
  return `${openNodes} node${openNodes === 1 ? "" : "s"} are visible as open headroom in the current filters.`;
}

function fleetCommand(alias: string): string {
  return `ssh ${alias} 'squeue -t R -o "%.18i|%.20j|%.12u|%.8P|%.12T|%C|%b|%N"; sinfo -N -o "%N|%T|%C|%G|%P"'`;
}

function compareNodes(left: AllocationNode, right: AllocationNode): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.activity - left.activity || left.name.localeCompare(right.name);
}

function toneRank(tone: AllocationTone): number {
  return { open: 0, blocked: 1, active: 2, shadow: 3 }[tone];
}
