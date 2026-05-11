import { formatDuration, formatMemory, shortTime } from "../api";
import type { QueueJob } from "../types";

export type InteractiveTone = "clear" | "watch" | "blocked";

export type InteractiveCommand = {
  label: string;
  value: string;
};

export type InteractiveSession = {
  jobId: string;
  name: string;
  state: string;
  tone: InteractiveTone;
  title: string;
  detail: string;
  facts: { label: string; value: string }[];
  commands: InteractiveCommand[];
};

export type InteractiveSessionSentinel = {
  sessions: InteractiveSession[];
  running: number;
  pending: number;
  expiring: number;
  label: string;
  message: string;
};

const NOTEBOOK_TERMS = ["jupyter", "notebook", "vscode", "interactive", "shell"];

export function buildInteractiveSessionSentinel(jobs: QueueJob[], alias: string): InteractiveSessionSentinel {
  const sessions = jobs.filter(isInteractive).map((job) => sessionFor(job, alias)).sort(compareSessions);
  const running = sessions.filter((session) => session.state === "RUNNING").length;
  const pending = sessions.filter((session) => session.state === "PENDING").length;
  const expiring = sessions.filter((session) => session.title === "Notebook deadline").length;
  return {
    sessions,
    running,
    pending,
    expiring,
    label: labelFor(running, pending, expiring),
    message: messageFor(running, pending, expiring),
  };
}

function isInteractive(job: QueueJob): boolean {
  const name = (job.name ?? "").toLowerCase();
  const partition = (job.partition ?? "").toLowerCase();
  if (partition.includes("interactive")) return true;
  return NOTEBOOK_TERMS.some((term) => name.includes(term));
}

function sessionFor(job: QueueJob, alias: string): InteractiveSession {
  const remainingSeconds = remaining(job);
  const node = job.nodes[0] ?? null;
  const running = job.state === "RUNNING";
  const expiring = running && remainingSeconds !== null && remainingSeconds <= 3600;
  const pending = job.state === "PENDING";
  const title = expiring ? "Notebook deadline" : pending ? "Session waiting" : running ? "Notebook tunnel is live" : "Session watch";
  const tone: InteractiveTone = expiring || (pending && !job.estimated_start_time) ? "blocked" : pending ? "watch" : "clear";
  return {
    jobId: job.job_id,
    name: job.name ?? "interactive session",
    state: job.state,
    tone,
    title,
    detail: detailFor(job, remainingSeconds, node),
    facts: factsFor(job, remainingSeconds, node),
    commands: commandsFor(job, alias, node),
  };
}

function detailFor(job: QueueJob, remainingSeconds: number | null, node: string | null): string {
  if (job.state === "RUNNING" && remainingSeconds !== null) {
    return `${job.name ?? job.job_id} is attached to ${node ?? "an allocated node"} with ${formatDuration(remainingSeconds)} left. Keep browser traffic tunneled through the login host.`;
  }
  if (job.state === "RUNNING") {
    return `${job.name ?? job.job_id} is live, but walltime is not parsed. Inspect the allocation before leaving notebooks unattended.`;
  }
  if (job.estimated_start_time) {
    return `Slurm projects this session around ${shortTime(job.estimated_start_time)}. Avoid resubmitting unless the estimate slips.`;
  }
  return `${job.name ?? job.job_id} is waiting without a start estimate. Partition, QOS, or scarce GPU fit may be the real gate.`;
}

function factsFor(job: QueueJob, remainingSeconds: number | null, node: string | null): { label: string; value: string }[] {
  return [
    { label: "node", value: node ?? "pending" },
    { label: "remaining", value: remainingSeconds === null ? "unknown" : formatDuration(remainingSeconds) },
    { label: "request", value: `${job.cpus} CPU / ${formatMemory(job.memory_mb)} / ${job.gpu_count} GPU` },
    { label: "tunnel", value: node ? `8888 -> ${node}:8888` : "wait for node" },
  ];
}

function commandsFor(job: QueueJob, alias: string, node: string | null): InteractiveCommand[] {
  const inspect = job.state === "PENDING"
    ? `ssh ${alias} 'squeue -j ${job.job_id} --start; scontrol show job -dd ${job.job_id} | sed -n "1,100p"'`
    : `ssh ${alias} 'sacct -j ${job.job_id} --format=JobID,JobName,State,Elapsed,Timelimit,NodeList,ReqTRES,AllocTRES -P; scontrol show job -dd ${job.job_id} | sed -n "1,100p"'`;
  const commands = [{ label: "inspect", value: inspect }];
  if (node) commands.unshift({ label: "tunnel", value: `ssh -L 8888:${node}:8888 ${alias}` });
  return commands;
}

function remaining(job: QueueJob): number | null {
  if (!job.time_limit_seconds || job.elapsed_seconds === null || job.elapsed_seconds === undefined) return null;
  return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
}

function labelFor(running: number, pending: number, expiring: number): string {
  if (expiring) return `${expiring} session deadline${expiring === 1 ? "" : "s"}`;
  if (running) return `${running} live session${running === 1 ? "" : "s"}`;
  if (pending) return `${pending} waiting session${pending === 1 ? "" : "s"}`;
  return "no live sessions";
}

function messageFor(running: number, pending: number, expiring: number): string {
  if (expiring) return "A notebook allocation is close to walltime; save state before Slurm tears the session down.";
  if (running) return "Interactive compute is active on a compute node. Keep notebooks tunneled and heavy work off the login host.";
  if (pending) return "An interactive request is queued; the visible reason may hide partition or QOS limits.";
  return "No notebook or interactive allocations are visible for this user.";
}

function compareSessions(left: InteractiveSession, right: InteractiveSession): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: InteractiveTone): number {
  return { clear: 0, watch: 1, blocked: 2 }[tone];
}
