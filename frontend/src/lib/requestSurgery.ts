import { formatDuration, formatMemory } from "../api";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";

export type RequestSurgeryTone = "rewrite" | "blocked" | "monitor";

export type RequestSurgeryItem = {
  jobId: string;
  jobName: string;
  tone: RequestSurgeryTone;
  title: string;
  delta: string;
  detail: string;
  command: string;
};

export type RequestSurgery = {
  label: string;
  headline: string;
  items: RequestSurgeryItem[];
};

export function buildRequestSurgery(
  jobs: QueueJob[],
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  alias: string
): RequestSurgery {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const items = pending.map((job) => surgeryFor(job, nodes, partitions, alias)).sort(compareItems).slice(0, 5);
  const rewrite = items.filter((item) => item.tone === "rewrite").length;
  const blocked = items.filter((item) => item.tone === "blocked").length;
  return {
    label: pending.length ? `${rewrite} rewrite / ${blocked} gate${blocked === 1 ? "" : "s"}` : "no surgery",
    headline: headlineFor(rewrite, blocked, pending.length),
    items
  };
}

function surgeryFor(
  job: QueueJob,
  nodes: NodeResource[],
  partitions: PartitionSummary[],
  alias: string
): RequestSurgeryItem {
  if (isGated(job)) return gated(job, alias);
  const partition = partitions.find((item) => item.name === job.partition);
  const candidates = nodes.filter((node) => node.is_available && (!job.partition || node.partitions.includes(job.partition)));
  const largestGpu = Math.max(0, ...candidates.map((node) => node.gpu_free));
  const largestCpu = Math.max(0, ...candidates.map((node) => node.cpus_idle));

  if (job.gpu_count >= 2 && largestGpu < job.gpu_count) return splitGpu(job, largestGpu);
  if ((job.time_limit_seconds ?? 0) >= 24 * 3600) return shortenWalltime(job, partition);
  if (!job.time_limit_seconds) return explicitWalltime(job);
  if (job.cpus > largestCpu && largestCpu > 0) return shrinkCpu(job, largestCpu);
  return monitor(job, alias);
}

function gated(job: QueueJob, alias: string): RequestSurgeryItem {
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    tone: "blocked",
    title: "Resolve scheduler gate first",
    delta: job.dependency ?? job.state_reason ?? "scheduler gate",
    detail: `${job.name ?? job.job_id} is gated before CPU, GPU, memory, or partition changes can help.`,
    command: `ssh ${alias} 'scontrol show job -dd ${job.job_id} | sed -n "1,160p"; squeue -j ${job.job_id} --start'`
  };
}

function splitGpu(job: QueueJob, largestGpu: number): RequestSurgeryItem {
  const gpuType = job.gpus[0]?.type;
  const gres = gpuType ? `#SBATCH --gres=gpu:${gpuType}:1` : "#SBATCH --gres=gpu:1";
  const concurrency = Math.max(1, largestGpu);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    tone: "rewrite",
    title: "Split wide GPU allocation",
    delta: `${gres}\n#SBATCH --array=0-${job.gpu_count - 1}%${concurrency}`,
    detail: `Largest visible GPU fit is ${largestGpu}; split ${job.gpu_count} GPU into smaller array work if the experiment allows it.`,
    command: `${gres}\n#SBATCH --array=0-${job.gpu_count - 1}%${concurrency}`
  };
}

function shortenWalltime(job: QueueJob, partition: PartitionSummary | undefined): RequestSurgeryItem {
  const suggestion = suggestedWalltime(job.time_limit_seconds, partition);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    tone: "rewrite",
    title: "Shorten walltime for backfill",
    delta: `#SBATCH --time=${suggestion}`,
    detail: `${job.name ?? job.job_id} asks for ${formatDuration(job.time_limit_seconds)} on ${job.cpus} CPU; ${suggestion} creates more backfill windows without changing hardware.`,
    command: `#SBATCH --time=${suggestion}`
  };
}

function explicitWalltime(job: QueueJob): RequestSurgeryItem {
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    tone: "rewrite",
    title: "Declare walltime explicitly",
    delta: "#SBATCH --time=04:00:00",
    detail: "Implicit walltime weakens turnover forecasts; declare a realistic cap before resubmitting.",
    command: "#SBATCH --time=04:00:00"
  };
}

function shrinkCpu(job: QueueJob, largestCpu: number): RequestSurgeryItem {
  const target = Math.max(1, largestCpu);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    tone: "rewrite",
    title: "Shrink CPU width",
    delta: `#SBATCH --cpus-per-task=${target}`,
    detail: `${job.name ?? job.job_id} requests ${job.cpus} CPU, but the largest visible idle fit is ${target}.`,
    command: `#SBATCH --cpus-per-task=${target}`
  };
}

function monitor(job: QueueJob, alias: string): RequestSurgeryItem {
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    tone: "monitor",
    title: "Keep shape and watch turnover",
    delta: `${job.cpus} CPU / ${formatMemory(job.memory_mb)} / ${job.gpu_count} GPU`,
    detail: "No safe shape edit is obvious from the visible snapshot; inspect priority and start estimates before churn.",
    command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}'`
  };
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function suggestedWalltime(seconds: number | null, partition: PartitionSummary | undefined): string {
  const max = seconds ?? parseSlurmTime(partition?.default_time ?? null) ?? 4 * 3600;
  const target = Math.min(max / 2, 12 * 3600);
  const hours = Math.max(1, Math.round(target / 3600));
  return `${String(hours).padStart(2, "0")}:00:00`;
}

function parseSlurmTime(value: string | null): number | null {
  if (!value || value === "UNLIMITED" || value === "Partition_Limit") return null;
  const [dayPart, clock] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const pieces = clock.split(":").map(Number);
  if (pieces.some(Number.isNaN)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = pieces.length === 3 ? pieces : [0, pieces[0] ?? 0, pieces[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function headlineFor(rewrite: number, blocked: number, pending: number): string {
  if (!pending) return "No pending jobs are visible for request surgery.";
  if (rewrite && blocked) {
    return `${rewrite} pending job${rewrite === 1 ? "" : "s"} ${rewrite === 1 ? "has" : "have"} a safe shape change; ${blocked} ${blocked === 1 ? "is" : "are"} blocked before resources matter.`;
  }
  if (rewrite) return `${rewrite} pending job${rewrite === 1 ? "" : "s"} can be made more scheduler-friendly.`;
  if (blocked) return `${blocked} pending job${blocked === 1 ? " is" : "s are"} gated before resource surgery can help.`;
  return "Visible pending jobs do not expose a safe request-shape edit.";
}

function compareItems(left: RequestSurgeryItem, right: RequestSurgeryItem): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: RequestSurgeryTone): number {
  return { monitor: 0, blocked: 1, rewrite: 2 }[tone];
}
