import { formatDuration, formatMemory, shortTime } from "../api";
import type { NodeResource, PriorityJob, QueueJob, SchedulerHealth } from "../types";

export type StartPathStageTone = "pass" | "watch" | "blocked" | "unknown";

export type StartPathStage = {
  key: "gate" | "fit" | "priority" | "backfill" | "estimate";
  label: string;
  tone: StartPathStageTone;
  value: string;
  detail: string;
};

export type StartPathRow = {
  jobId: string;
  name: string;
  partition: string;
  tone: "clear" | "watch" | "blocked";
  summary: string;
  action: string;
  stages: StartPathStage[];
  command: string;
};

export type StartPathDecoder = {
  label: string;
  headline: string;
  rows: StartPathRow[];
};

type Fit = {
  count: number;
  largestCpu: number;
  largestGpu: number;
  largestMemoryMb: number;
  shortage: string | null;
  occupants: string[];
};

export function buildStartPathDecoder({
  jobs,
  nodes,
  priorityJobs,
  scheduler,
  alias
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  priorityJobs: PriorityJob[];
  scheduler: SchedulerHealth | null;
  alias: string;
}): StartPathDecoder {
  const rows = jobs
    .filter((job) => job.state === "PENDING")
    .map((job) => rowFor(job, jobs, nodes, priorityJobs, scheduler, alias))
    .sort(compareRows);
  const blocked = rows.filter((row) => row.tone === "blocked").length;
  const dated = rows.filter((row) => row.stages.some((stage) => stage.key === "estimate" && stage.tone === "pass")).length;
  const fit = rows.filter((row) => row.stages.some((stage) => stage.key === "fit" && stage.tone === "pass")).length;
  return {
    label: rows.length ? `${blocked} blocked / ${dated} dated / ${fit} fit` : "no pending path",
    headline: headlineFor(rows.length, blocked, rows.filter((row) => row.tone === "watch").length),
    rows
  };
}

function rowFor(
  job: QueueJob,
  jobs: QueueJob[],
  nodes: NodeResource[],
  priorityJobs: PriorityJob[],
  scheduler: SchedulerHealth | null,
  alias: string
): StartPathRow {
  const fit = fitFor(job, jobs, nodes);
  const gate = gateStage(job);
  const stages = [gate, fitStage(job, fit), priorityStage(job, priorityJobs), backfillStage(job, scheduler), estimateStage(job, gate, fit)];
  const tone = rowTone(stages);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    partition: job.partition ?? "n/a",
    tone,
    summary: summaryFor(job, gate, fit, stages),
    action: actionFor(job, gate, fit, stages),
    stages,
    command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}; scontrol show job -dd ${job.job_id} | sed -n "1,160p"; sdiag 2>/dev/null | sed -n "1,80p"'`
  };
}

function gateStage(job: QueueJob): StartPathStage {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  const gated = Boolean(job.dependency) || /depend|hold|begin/.test(reason);
  if (!gated) return stage("gate", "Gate", "pass", "open", "No dependency, hold, or begin-time gate is visible.");
  return stage("gate", "Gate", "blocked", job.dependency ?? job.state_reason ?? "scheduler gate", "Gate clears before placement, priority, or backfill can help.");
}

function fitStage(job: QueueJob, fit: Fit): StartPathStage {
  const detail = `largest visible fit ${fit.largestCpu} CPU / ${formatMemory(fit.largestMemoryMb)} / ${fit.largestGpu} GPU${fit.occupants.length ? `; occupied by ${fit.occupants.join(", ")}` : ""}.`;
  if (fit.count > 0) return stage("fit", "Fit", "pass", `${fit.count} node fit`, detail);
  return stage("fit", "Fit", "blocked", fit.shortage ?? "no node fit", detail);
}

function priorityStage(job: QueueJob, priorityJobs: PriorityJob[]): StartPathStage {
  const decoded = priorityJobs.find((item) => item.job_id === job.job_id);
  if (decoded) {
    const tone = decoded.priority < 200 ? "watch" : "pass";
    const factor = decoded.dominant_factor ?? "score";
    return stage("priority", "Priority", tone, `${factor} ${decoded.priority}`, `${factor} is the largest visible priority input.`);
  }
  if (job.priority !== null) return stage("priority", "Priority", "unknown", String(job.priority), "Only the raw priority number is visible in this snapshot.");
  return stage("priority", "Priority", "unknown", "n/a", "sprio data is not available for this job.");
}

function backfillStage(job: QueueJob, scheduler: SchedulerHealth | null): StartPathStage {
  if (!job.time_limit_seconds) return stage("backfill", "Backfill", "watch", "implicit", "Declare walltime so backfill can reason about the hole this job needs.");
  if (job.time_limit_seconds >= 24 * 3600) {
    return stage("backfill", "Backfill", "watch", formatDuration(job.time_limit_seconds), "Long walltime can miss short backfill holes even when resources fit.");
  }
  const depth = scheduler?.backfill_last_depth ?? null;
  if (depth === null) return stage("backfill", "Backfill", "unknown", formatDuration(job.time_limit_seconds), "Backfill depth is not available.");
  return stage("backfill", "Backfill", "pass", `${depth} depth`, `${formatDuration(job.time_limit_seconds)} walltime is visible to backfill.`);
}

function estimateStage(job: QueueJob, gate: StartPathStage, fit: Fit): StartPathStage {
  if (gate.tone === "blocked") return stage("estimate", "Estimate", "blocked", "gated", "Slurm will not produce useful timing until the gate clears.");
  if (!fit.count) return stage("estimate", "Estimate", "blocked", "no fit", "A dated start is unlikely until a fitting node shape appears.");
  if (job.estimated_start_time) return stage("estimate", "Estimate", "pass", shortTime(job.estimated_start_time), "Slurm exposed a dated start for this job.");
  return stage("estimate", "Estimate", "watch", "none", "No public start estimate; priority, turnover, or backfill is still unresolved.");
}

function fitFor(job: QueueJob, jobs: QueueJob[], nodes: NodeResource[]): Fit {
  const candidates = nodes.filter((node) => node.is_available && (!job.partition || node.partitions.includes(job.partition)));
  const largestCpu = Math.max(0, ...candidates.map((node) => node.cpus_idle));
  const largestGpu = Math.max(0, ...candidates.map((node) => node.gpu_free));
  const largestMemoryMb = Math.max(0, ...candidates.map((node) => node.memory_free_mb ?? node.memory_total_mb));
  const count = candidates.filter((node) => fits(node, job)).length;
  return {
    count,
    largestCpu,
    largestGpu,
    largestMemoryMb,
    shortage: shortageFor(job, candidates, largestCpu, largestGpu, largestMemoryMb),
    occupants: occupantsFor(candidates, jobs)
  };
}

function shortageFor(job: QueueJob, candidates: NodeResource[], largestCpu: number, largestGpu: number, largestMemoryMb: number): string | null {
  if (!candidates.length) return "no available nodes";
  if (job.gpu_count > largestGpu) return `largest GPU fit ${largestGpu}/${job.gpu_count}`;
  if (job.cpus > largestCpu) return `largest CPU fit ${largestCpu}/${job.cpus}`;
  if ((job.memory_mb ?? 0) > largestMemoryMb) return `largest memory fit ${formatMemory(largestMemoryMb)}`;
  return "no visible node fit";
}

function occupantsFor(candidates: NodeResource[], jobs: QueueJob[]): string[] {
  const names = new Set(candidates.map((node) => node.name));
  return jobs
    .filter((job) => job.state === "RUNNING" && job.nodes.some((node) => names.has(node)))
    .slice(0, 2)
    .map((job) => `${job.name ?? job.job_id} on ${job.nodes[0]}`);
}

function fits(node: NodeResource, job: QueueJob): boolean {
  const memory = node.memory_free_mb ?? node.memory_total_mb;
  return node.cpus_idle >= job.cpus && memory >= (job.memory_mb ?? 0) && node.gpu_free >= job.gpu_count;
}

function summaryFor(job: QueueJob, gate: StartPathStage, fit: Fit, stages: StartPathStage[]): string {
  const name = job.name ?? job.job_id;
  if (gate.tone === "blocked") return `${name} is held by ${gate.value}; resource edits cannot move it until the gate clears.`;
  if (!fit.count) return `${name} cannot fit visible idle nodes: ${fit.shortage ?? "no node fit"}.`;
  if (job.estimated_start_time) return `${name} has a dated start estimate; the main lever is walltime only if the estimate slips.`;
  if (stages.some((stage) => stage.key === "priority" && stage.tone === "unknown")) {
    return `${name} fits visible nodes, but decoded priority evidence is missing.`;
  }
  return `${name} fits visible nodes; wait on turnover unless backfill or priority starts slipping.`;
}

function actionFor(job: QueueJob, gate: StartPathStage, fit: Fit, stages: StartPathStage[]): string {
  if (gate.tone === "blocked") return "Inspect upstream dependency before changing CPU, GPU, memory, or walltime.";
  if (!fit.count) return "Shrink the widest resource request or target a partition with a fitting node class.";
  if (stages.some((stage) => stage.key === "backfill" && stage.tone === "watch")) return "Shorten walltime if the run can checkpoint cleanly.";
  if (job.estimated_start_time) return "Keep the current shape unless the dated estimate slips.";
  return "Probe sprio and squeue --start before resubmitting.";
}

function headlineFor(total: number, blocked: number, watch: number): string {
  if (!total) return "No pending jobs need start-path decoding in this filter.";
  if (blocked) return `${blocked} pending job${blocked === 1 ? " is" : "s are"} blocked before normal backfill math.`;
  if (watch) return `${watch} pending job${watch === 1 ? " needs" : "s need"} priority, walltime, or estimate attention before waiting blindly.`;
  return "All visible pending jobs have coherent scheduler start paths.";
}

function rowTone(stages: StartPathStage[]): StartPathRow["tone"] {
  if (stages.some((stage) => stage.tone === "blocked")) return "blocked";
  if (stages.some((stage) => stage.tone === "watch" || stage.tone === "unknown")) return "watch";
  return "clear";
}

function stage(
  key: StartPathStage["key"],
  label: string,
  tone: StartPathStageTone,
  value: string,
  detail: string
): StartPathStage {
  return { key, label, tone, value, detail };
}

function compareRows(left: StartPathRow, right: StartPathRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: StartPathRow["tone"]): number {
  return { clear: 0, watch: 1, blocked: 2 }[tone];
}
