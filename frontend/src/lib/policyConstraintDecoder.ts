import { formatDuration } from "../api";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";

export type PolicyConstraintTone = "clear" | "watch" | "blocked";

export type PolicyConstraintSignal = {
  label: string;
  value: string;
  tone: PolicyConstraintTone;
};

export type PolicyConstraintRow = {
  jobId: string;
  name: string;
  partition: string;
  tone: PolicyConstraintTone;
  title: string;
  detail: string;
  action: string;
  signals: PolicyConstraintSignal[];
  command: string;
};

export type PolicyConstraintDecoder = {
  label: string;
  headline: string;
  rows: PolicyConstraintRow[];
};

export function buildPolicyConstraintDecoder({
  jobs,
  nodes,
  partitions,
  alias
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  alias: string;
}): PolicyConstraintDecoder {
  const rows = jobs
    .filter((job) => job.state === "PENDING")
    .map((job) => rowFor(job, nodes, partitions, alias))
    .filter((row): row is PolicyConstraintRow => Boolean(row))
    .sort(compareRows);
  const blocked = rows.filter((row) => row.tone === "blocked").length;
  const watch = rows.filter((row) => row.tone === "watch").length;
  const clear = rows.filter((row) => row.tone === "clear").length;
  return {
    label: rows.length ? `${blocked} blocked / ${watch} watch / ${clear} clear` : "no policy fields",
    headline: headlineFor(rows.length, blocked, watch),
    rows
  };
}

function rowFor(
  job: QueueJob,
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  alias: string
): PolicyConstraintRow | null {
  const constraints = job.constraints ?? [];
  const requiredNodes = job.required_nodes ?? [];
  const excludedNodes = job.excluded_nodes ?? [];
  const licenses = job.licenses ?? [];
  const partition = partitions.find((item) => item.name === job.partition);
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  const partitionNodes = nodes.filter((node) => !job.partition || node.partitions.includes(job.partition));
  const matchingNodes = constraints.length ? partitionNodes.filter((node) => matchesConstraints(node, constraints)) : partitionNodes;
  const schedulableMatches = matchingNodes.filter((node) => node.is_available);
  const requiredHealth = requiredNodeHealth(requiredNodes, nodes);
  const signals = signalsFor(job, constraints, requiredNodes, excludedNodes, licenses, matchingNodes, schedulableMatches, partition);
  const command = commandFor(alias, job.job_id);

  if (requiredHealth.blocked.length) {
    const first = requiredHealth.blocked[0];
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "blocked",
      title: "Pinned node unavailable",
      detail: `${job.name ?? job.job_id} requires ${first.name}, but the visible node is ${first.state}.`,
      action: `Remove --nodelist or target a healthy ${gpuShape(job)} node class before waiting on priority.`,
      signals,
      command
    };
  }

  if (isPolicyReason(reason)) {
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "blocked",
      title: "Policy cap before placement",
      detail: `${job.name ?? job.job_id} is stopped by ${job.state_reason ?? "policy"} before nodes, GPUs, or backfill can help.`,
      action: "Check QOS/account limits and active allocations before changing resource shape.",
      signals,
      command
    };
  }

  if (partition && exceedsPartitionTime(job, partition)) {
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "blocked",
      title: "Partition walltime limit",
      detail: `${job.name ?? job.job_id} asks for ${formatDuration(job.time_limit_seconds)} while ${partition.name} allows ${partition.max_time ?? "n/a"}.`,
      action: "Move to a longer partition or shorten walltime before queue position matters.",
      signals,
      command
    };
  }

  if (constraints.length && !matchingNodes.length) {
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "blocked",
      title: "Constraint has no landing zone",
      detail: `No visible ${job.partition ?? "cluster"} node advertises ${constraints.join(", ")}; total free GPU count is misleading.`,
      action: "Relax --constraint or pick a partition that actually contains that feature set.",
      signals,
      command
    };
  }

  if (constraints.length && !schedulableMatches.length) {
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "watch",
      title: "Constraint only matches busy or unhealthy nodes",
      detail: `${constraints.join(", ")} exists on ${matchingNodes.length} visible node(s), but none are schedulable now.`,
      action: "Wait for that node class to return or loosen constraints if the workload is portable.",
      signals,
      command
    };
  }

  if (isReservationOrLicense(reason) || job.reservation || licenses.length) {
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "watch",
      title: "Reservation or license gate",
      detail: `${job.name ?? job.job_id} carries ${[job.reservation ? `reservation ${job.reservation}` : null, licenses.length ? `licenses ${licenses.join(", ")}` : null].filter(Boolean).join(" and ") || job.state_reason}.`,
      action: "Confirm reservation access or license availability before resizing the job.",
      signals,
      command
    };
  }

  if (constraints.length || job.qos || requiredNodes.length || excludedNodes.length) {
    return {
      jobId: job.job_id,
      name: job.name ?? job.job_id,
      partition: job.partition ?? "n/a",
      tone: "clear",
      title: constraints.length ? "Constraint has visible landing zone" : "Policy fields are visible",
      detail: constraints.length
        ? `${job.name ?? job.job_id} exposes constraints ${constraints.join(", ")} with ${schedulableMatches.length} visible matching node${schedulableMatches.length === 1 ? "" : "s"}.`
        : `${job.name ?? job.job_id} exposes QOS ${job.qos ?? "n/a"} without a visible policy blocker.`,
      action: "Treat queue order, walltime, and current occupancy as the next scheduling levers.",
      signals,
      command
    };
  }

  return null;
}

function signalsFor(
  job: QueueJob,
  constraints: string[],
  requiredNodes: string[],
  excludedNodes: string[],
  licenses: string[],
  matchingNodes: NodeResource[],
  schedulableMatches: NodeResource[],
  partition: PartitionSummary | undefined
): PolicyConstraintSignal[] {
  return [
    signal("qos", job.qos ?? "n/a", policyTone(job)),
    signal("constraint", constraints.length ? constraints.join(", ") : "none", constraints.length && !matchingNodes.length ? "blocked" : "clear"),
    signal("landing", constraints.length ? `${schedulableMatches.length}/${matchingNodes.length}` : "n/a", constraints.length && !schedulableMatches.length ? "watch" : "clear"),
    signal("nodes", requiredNodes.length ? requiredNodes.join(", ") : excludedNodes.length ? `exclude ${excludedNodes.join(", ")}` : "flexible", requiredNodes.length ? "watch" : "clear"),
    signal("walltime", partition?.max_time ?? "n/a", partition && exceedsPartitionTime(job, partition) ? "blocked" : "clear"),
    signal("licenses", licenses.length ? licenses.join(", ") : "none", licenses.length ? "watch" : "clear")
  ];
}

function signal(label: string, value: string, tone: PolicyConstraintTone): PolicyConstraintSignal {
  return { label, value, tone };
}

function requiredNodeHealth(requiredNodes: string[], nodes: NodeResource[]) {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const blocked = requiredNodes
    .map((name) => {
      const node = byName.get(name);
      return { name, state: node ? stateText(node) : "missing from snapshot", blocked: !node || !node.is_available };
    })
    .filter((node) => node.blocked);
  return { blocked };
}

function matchesConstraints(node: NodeResource, constraints: string[]): boolean {
  const haystack = new Set([...node.features, ...node.gpu_types, ...node.gres.map((gpu) => gpu.type)].map((item) => item.toLowerCase()));
  return constraints.every((item) => haystack.has(item.toLowerCase()));
}

function isPolicyReason(reason: string): boolean {
  return /qos|assoc|limit|account|policy/.test(reason);
}

function isReservationOrLicense(reason: string): boolean {
  return /reservation|license/.test(reason);
}

function policyTone(job: QueueJob): PolicyConstraintTone {
  return isPolicyReason(`${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase()) ? "blocked" : "clear";
}

function exceedsPartitionTime(job: QueueJob, partition: PartitionSummary): boolean {
  const max = parseSlurmTime(partition.max_time);
  return Boolean(max && job.time_limit_seconds && job.time_limit_seconds > max);
}

function parseSlurmTime(value: string | null): number | null {
  if (!value || value === "UNLIMITED" || value === "Partition_Limit") return null;
  const [dayPart, clock] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const pieces = clock.split(":").map(Number);
  if (pieces.some(Number.isNaN)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = pieces.length === 3 ? pieces : [0, pieces[0] ?? 0, pieces[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function stateText(node: NodeResource): string {
  return [node.state, ...(node.state_flags ?? [])].join("+");
}

function gpuShape(job: QueueJob): string {
  return job.gpus[0]?.type ?? (job.gpu_count ? "GPU" : "CPU");
}

function headlineFor(total: number, blocked: number, watch: number): string {
  if (!total) return "No pending jobs expose QOS, constraints, reservations, licenses, or node pins in this filter.";
  if (blocked) return `${blocked} pending job${blocked === 1 ? "" : "s"} has policy or constraint evidence that can block placement before priority helps.`;
  if (watch) return `${watch} pending job${watch === 1 ? "" : "s"} needs policy or constraint confirmation before queue estimates are trusted.`;
  return "Visible policy and constraint fields have plausible landing zones; queue order and turnover are the next levers.";
}

function commandFor(alias: string, jobId: string): string {
  return `ssh ${alias} 'scontrol show job -dd ${jobId} | sed -n "1,180p"; sinfo -N -o "%N|%t|%P|%f|%G" | sed -n "1,80p"; sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n'`;
}

function compareRows(left: PolicyConstraintRow, right: PolicyConstraintRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: PolicyConstraintTone): number {
  return { clear: 0, watch: 1, blocked: 2 }[tone];
}
