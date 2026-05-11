import type { QueueJob } from "../types";

export type DependencyKind = "dependency" | "hold" | "begin" | "broken";

export type DependencyRadarItem = {
  jobId: string;
  jobName: string;
  user: string;
  kind: DependencyKind;
  label: string;
  severity: "info" | "warning" | "critical";
  dependency: string;
  blockers: string[];
  message: string;
  action: string;
  command: string;
};

export type DependencyRadar = {
  total: number;
  label: string;
  message: string;
  items: DependencyRadarItem[];
};

export function buildDependencyRadar(jobs: QueueJob[], alias: string): DependencyRadar {
  const items = jobs
    .filter((job) => job.state === "PENDING")
    .map((job) => itemFor(job, alias))
    .filter((item): item is DependencyRadarItem => item !== null)
    .sort(compareItems);
  return {
    total: items.length,
    label: items.length ? `${items.length} gate${items.length === 1 ? "" : "s"}` : "clear",
    message: summary(items),
    items
  };
}

function itemFor(job: QueueJob, alias: string): DependencyRadarItem | null {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  const dependency = job.dependency?.trim() ?? "";
  const kind = kindFor(reason, dependency);
  if (!kind) return null;
  const blockers = blockerIds(dependency);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    user: job.user,
    kind,
    label: labelFor(kind),
    severity: severityFor(kind),
    dependency: dependency || job.state_reason || "scheduler gate",
    blockers,
    message: messageFor(kind, job, dependency, blockers),
    action: actionFor(kind),
    command: commandFor(alias, job.job_id, blockers)
  };
}

function kindFor(reason: string, dependency: string): DependencyKind | null {
  if (/invalid|never/.test(reason)) return "broken";
  if (/held|hold/.test(reason)) return "hold";
  if (/begin/.test(reason)) return "begin";
  if (dependency || /depend/.test(reason)) return "dependency";
  return null;
}

function labelFor(kind: DependencyKind): string {
  if (kind === "broken") return "broken dependency";
  if (kind === "hold") return "held job";
  if (kind === "begin") return "begin-time gate";
  return "dependency gate";
}

function severityFor(kind: DependencyKind): DependencyRadarItem["severity"] {
  if (kind === "broken") return "critical";
  if (kind === "hold") return "warning";
  return "info";
}

function messageFor(kind: DependencyKind, job: QueueJob, dependency: string, blockers: string[]): string {
  if (kind === "broken") return `${job.name ?? job.job_id} has a dependency Slurm believes cannot be satisfied.`;
  if (kind === "hold") return `${job.name ?? job.job_id} is held before resources, priority, or backfill can matter.`;
  if (kind === "begin") return `${job.name ?? job.job_id} is waiting for a requested begin time, not cluster capacity.`;
  if (blockers.length) return `${job.name ?? job.job_id} waits on ${dependency}; inspect ${blockers.length} upstream job${blockers.length === 1 ? "" : "s"}.`;
  return `${job.name ?? job.job_id} is dependency-gated, but the visible dependency expression is incomplete.`;
}

function actionFor(kind: DependencyKind): string {
  if (kind === "broken") return "Inspect the dependency expression before resubmitting dependent work.";
  if (kind === "hold") return "Check whether the hold is user-requested or administrator-controlled.";
  if (kind === "begin") return "Verify the begin time before changing CPU, GPU, memory, or partition.";
  return "Follow the upstream job state before modifying the resource request.";
}

function commandFor(alias: string, jobId: string, blockers: string[]): string {
  const blockerProbe = blockers.length ? `; squeue -j ${blockers.slice(0, 20).join(",")} -o "%i|%j|%T|%M|%R"` : "";
  return `ssh ${alias} ${shellQuote(`scontrol show job -dd ${jobId}${blockerProbe}`)}`;
}

function blockerIds(dependency: string): string[] {
  return Array.from(new Set(dependency.match(/\d+/g) ?? []));
}

function summary(items: DependencyRadarItem[]): string {
  if (!items.length) return "No dependency, hold, or begin-time gates are visible in the current queue filters.";
  if (items.some((item) => item.kind === "broken")) return "At least one job has a dependency that may never satisfy; resource tuning will not help it start.";
  if (items.some((item) => item.kind === "hold")) return "Held jobs are present; they need hold inspection before queue pressure analysis matters.";
  return "Some pending jobs are gated by workflow order rather than scarce GPUs, CPUs, memory, or priority.";
}

function compareItems(left: DependencyRadarItem, right: DependencyRadarItem): number {
  return severityRank(right.severity) - severityRank(left.severity) || left.jobId.localeCompare(right.jobId);
}

function severityRank(severity: DependencyRadarItem["severity"]): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
