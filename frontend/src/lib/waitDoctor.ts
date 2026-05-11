import { formatMemory, shortTime } from "../api";
import type { NodeResource, PartitionSummary, PriorityJob, QueueJob } from "../types";

export type WaitDoctorFactor = {
  label: string;
  value: string;
  severity: "info" | "warning" | "critical";
};

export type WaitDoctorItem = {
  jobId: string;
  jobName: string;
  partition: string;
  tone: "clear" | "watch" | "blocked";
  headline: string;
  request: string;
  factors: WaitDoctorFactor[];
  advice: string;
  command: string;
};

export type WaitDoctor = {
  total: number;
  blocked: number;
  watch: number;
  label: string;
  items: WaitDoctorItem[];
};

export function buildWaitDoctor(
  jobs: QueueJob[],
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  priorityJobs: PriorityJob[],
  alias: string
): WaitDoctor {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const items = pending.map((job) => itemFor(job, nodes, partitions, priorityJobs, alias)).sort(compareItems).slice(0, 6);
  const blocked = items.filter((item) => item.tone === "blocked").length;
  const watch = items.filter((item) => item.tone === "watch").length;
  return {
    total: pending.length,
    blocked,
    watch,
    label: pending.length ? `${blocked} blocked / ${watch} watch` : "clear",
    items
  };
}

function itemFor(
  job: QueueJob,
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  priorityJobs: PriorityJob[],
  alias: string
): WaitDoctorItem {
  const partition = partitions.find((item) => item.name === job.partition);
  const factors = [
    gateFactor(job),
    estimateFactor(job),
    fitFactor(job, nodes, partition),
    priorityFactor(job, priorityJobs),
    walltimeFactor(job, partition)
  ].filter((factor): factor is WaitDoctorFactor => Boolean(factor));
  const tone = toneFor(factors);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    partition: job.partition ?? "n/a",
    tone,
    headline: headlineFor(job, factors, tone),
    request: `${job.cpus} CPU / ${formatMemory(job.memory_mb)} / ${job.gpu_count} GPU`,
    factors,
    advice: adviceFor(job, factors, tone),
    command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}; scontrol show job -dd ${job.job_id} | sed -n "1,160p"'`
  };
}

function gateFactor(job: QueueJob): WaitDoctorFactor | null {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  if (job.dependency || /depend|hold|begin/.test(reason)) {
    return { label: "gate", value: job.dependency || job.state_reason || "scheduler gate", severity: "critical" };
  }
  return null;
}

function estimateFactor(job: QueueJob): WaitDoctorFactor {
  if (job.estimated_start_time) return { label: "start", value: shortTime(job.estimated_start_time), severity: "info" };
  return { label: "start", value: "no public estimate", severity: "warning" };
}

function fitFactor(job: QueueJob, nodes: NodeResource[], partition: PartitionSummary | undefined): WaitDoctorFactor {
  const candidates = nodes.filter((node) => node.is_available && (!job.partition || node.partitions.includes(job.partition)));
  const fitNodes = candidates.filter((node) => fitsJob(node, job)).length;
  if (fitNodes) return { label: "fit", value: `${fitNodes} node fit`, severity: "info" };
  const shortage = shortageFor(job, partition, candidates);
  return { label: "fit", value: shortage, severity: "critical" };
}

function priorityFactor(job: QueueJob, priorityJobs: PriorityJob[]): WaitDoctorFactor | null {
  const priority = priorityJobs.find((item) => item.job_id === job.job_id);
  if (!priority) return job.priority === null ? null : { label: "priority", value: String(job.priority), severity: "info" };
  const severity = priority.priority < 200 ? "warning" : "info";
  return { label: "priority", value: `${priority.dominant_factor ?? "score"} ${priority.priority}`, severity };
}

function walltimeFactor(job: QueueJob, partition: PartitionSummary | undefined): WaitDoctorFactor | null {
  const maxSeconds = parseSlurmTime(partition?.max_time ?? null);
  if (!job.time_limit_seconds) return { label: "walltime", value: "implicit/default", severity: "warning" };
  if (maxSeconds && job.time_limit_seconds > maxSeconds) return { label: "walltime", value: "above partition limit", severity: "critical" };
  if (job.time_limit_seconds >= 24 * 3600) return { label: "walltime", value: "long backfill shape", severity: "warning" };
  return null;
}

function fitsJob(node: NodeResource, job: QueueJob): boolean {
  const memory = node.memory_free_mb ?? node.memory_total_mb;
  return node.cpus_idle >= job.cpus && memory >= (job.memory_mb ?? 0) && node.gpu_free >= job.gpu_count;
}

function shortageFor(job: QueueJob, partition: PartitionSummary | undefined, nodes: NodeResource[]): string {
  if (job.gpu_count > 0 && Math.max(0, ...nodes.map((node) => node.gpu_free)) < job.gpu_count) return `largest GPU fit ${Math.max(0, ...nodes.map((node) => node.gpu_free))}`;
  if (partition && partition.cpus_idle < job.cpus) return `${partition.cpus_idle} idle CPU`;
  if (partition && job.memory_mb && partition.memory_free_mb < job.memory_mb) return `${formatMemory(partition.memory_free_mb)} free memory`;
  return "no visible node fit";
}

function headlineFor(job: QueueJob, factors: WaitDoctorFactor[], tone: WaitDoctorItem["tone"]): string {
  if (factors.some((factor) => factor.label === "gate")) return "Workflow gate, not capacity";
  if (factors.some((factor) => factor.label === "fit" && factor.severity === "critical")) return "Request shape cannot fit visible idle nodes";
  if (factors.some((factor) => factor.label === "priority" && factor.severity === "warning")) return "Priority looks weak relative to visible factors";
  if (job.estimated_start_time) return "Slurm exposed a start estimate";
  return tone === "blocked" ? "Blocked by visible scheduler evidence" : "No single hard blocker visible";
}

function adviceFor(job: QueueJob, factors: WaitDoctorFactor[], tone: WaitDoctorItem["tone"]): string {
  if (factors.some((factor) => factor.label === "gate")) return "Resolve dependency, hold, or begin-time fields before reshaping resources.";
  if (factors.some((factor) => factor.label === "fit" && factor.severity === "critical")) return "Shrink GPU, CPU, memory, or partition width before expecting backfill.";
  if (factors.some((factor) => factor.label === "walltime" && factor.severity === "warning")) return "Try a shorter walltime if the run can checkpoint cleanly.";
  if (job.estimated_start_time) return "Watch the start estimate and avoid churn unless it slips repeatedly.";
  return tone === "watch" ? "Inspect sprio and scontrol before changing the submission." : "The current shape looks plausible; wait for turnover or queue priority.";
}

function toneFor(factors: WaitDoctorFactor[]): WaitDoctorItem["tone"] {
  if (factors.some((factor) => factor.severity === "critical")) return "blocked";
  if (factors.some((factor) => factor.severity === "warning")) return "watch";
  return "clear";
}

function compareItems(left: WaitDoctorItem, right: WaitDoctorItem): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: WaitDoctorItem["tone"]): number {
  return { clear: 0, watch: 1, blocked: 2 }[tone];
}

function parseSlurmTime(value: string | null): number | null {
  if (!value || value === "UNLIMITED" || value === "Partition_Limit") return null;
  const [dayPart, clock] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const pieces = clock.split(":").map(Number);
  if (pieces.some(Number.isNaN)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = pieces.length === 3 ? pieces : [0, pieces[0] ?? 0, pieces[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}
