import type { HistoryJob, QueueJob } from "../types";

export type DependencyAuditTone = "satisfied" | "active" | "unknown" | "broken";

export type DependencyAuditItem = {
  jobId: string;
  jobName: string;
  user: string;
  dependency: string;
  blockers: string[];
  tone: DependencyAuditTone;
  label: string;
  evidence: string;
  action: string;
  command: string;
};

export type DependencyAudit = {
  audited: number;
  satisfied: number;
  active: number;
  unknown: number;
  broken: number;
  label: string;
  headline: string;
  items: DependencyAuditItem[];
};

type BlockerEvidence = {
  id: string;
  kind: string;
  queueState: string | null;
  historyState: string | null;
  exitCode: string | null;
};

export function buildDependencyAudit(
  jobs: QueueJob[],
  history: HistoryJob[],
  alias: string
): DependencyAudit {
  const queueById = new Map(jobs.map((job) => [baseId(job.job_id), job]));
  const historyById = new Map(history.map((job) => [baseId(job.job_id), job]));
  const items = jobs
    .filter((job) => job.state === "PENDING" && isDependencyJob(job))
    .map((job) => itemFor(job, queueById, historyById, alias))
    .sort(compareItems);
  const satisfied = items.filter((item) => item.tone === "satisfied").length;
  const active = items.filter((item) => item.tone === "active").length;
  const unknown = items.filter((item) => item.tone === "unknown").length;
  const broken = items.filter((item) => item.tone === "broken").length;
  return {
    audited: items.length,
    satisfied,
    active,
    unknown,
    broken,
    label: labelFor(items.length, satisfied, broken, unknown),
    headline: headlineFor(items.length, satisfied, active, unknown, broken),
    items
  };
}

function itemFor(
  job: QueueJob,
  queueById: Map<string, QueueJob>,
  historyById: Map<string, HistoryJob>,
  alias: string
): DependencyAuditItem {
  const dependency = job.dependency?.trim() || job.state_reason || "Dependency";
  const blockers = blockersFor(dependency);
  const evidence = blockers.map((blocker) => evidenceFor(blocker, queueById, historyById));
  const tone = toneFor(evidence);
  return {
    jobId: job.job_id,
    jobName: job.name ?? "unnamed",
    user: job.user,
    dependency,
    blockers: blockers.map((blocker) => blocker.id),
    tone,
    label: labelForTone(tone),
    evidence: evidenceText(job, evidence, tone),
    action: actionFor(tone),
    command: commandFor(alias, job.job_id, blockers.map((blocker) => blocker.id))
  };
}

function blockersFor(expression: string): { kind: string; id: string }[] {
  const rows: { kind: string; id: string }[] = [];
  for (const match of expression.matchAll(/([A-Za-z_]+):([0-9:,]+)/g)) {
    for (const id of match[2].split(/[,:]/).filter(Boolean)) rows.push({ kind: match[1].toLowerCase(), id });
  }
  if (!rows.length) {
    for (const id of expression.match(/\d+/g) ?? []) rows.push({ kind: "dependency", id });
  }
  return Array.from(new Map(rows.map((row) => [`${row.kind}-${row.id}`, row])).values());
}

function evidenceFor(
  blocker: { kind: string; id: string },
  queueById: Map<string, QueueJob>,
  historyById: Map<string, HistoryJob>
): BlockerEvidence {
  const queue = queueById.get(baseId(blocker.id));
  const history = historyById.get(baseId(blocker.id));
  return {
    id: blocker.id,
    kind: blocker.kind,
    queueState: queue?.state ?? null,
    historyState: history?.state ?? null,
    exitCode: history?.exit_code ?? null
  };
}

function toneFor(evidence: BlockerEvidence[]): DependencyAuditTone {
  if (!evidence.length) return "unknown";
  if (evidence.some((row) => row.kind === "afterok" && isFailed(row.historyState))) return "broken";
  if (evidence.some((row) => row.queueState === "RUNNING" || row.queueState === "PENDING")) return "active";
  if (evidence.some((row) => !row.historyState)) return "unknown";
  return "satisfied";
}

function evidenceText(job: QueueJob, evidence: BlockerEvidence[], tone: DependencyAuditTone): string {
  const name = job.name ?? job.job_id;
  if (!evidence.length) return `${name} is dependency-gated, but Slurm did not expose upstream job IDs in this snapshot.`;
  const ids = evidence.map((row) => row.id).join(", ");
  if (tone === "broken") return `${name} waits on ${ids}; at least one afterok upstream failed in recent accounting.`;
  if (tone === "active") return `${name} waits on ${ids}; at least one upstream job is still visible in the live queue.`;
  if (tone === "unknown") return `${name} waits on ${ids}, but recent queue and accounting data do not explain the upstream state.`;
  return `${name} depends on ${dependencyText(evidence)}, and recent accounting shows upstream job ${ids} completed.`;
}

function dependencyText(evidence: BlockerEvidence[]): string {
  return evidence.map((row) => `${row.kind}:${row.id}`).join(", ");
}

function actionFor(tone: DependencyAuditTone): string {
  if (tone === "broken") return "Cancel or rewrite the dependent job; resource changes will not satisfy a failed afterok chain.";
  if (tone === "active") return "Watch the upstream job first; reshaping the dependent job cannot move it yet.";
  if (tone === "unknown") return "Extend the sacct window or inspect the upstream ID before changing CPU, GPU, memory, or partition.";
  return "Verify the dependency field with scontrol; if it is gone, resources or priority are now the real blocker.";
}

function labelForTone(tone: DependencyAuditTone): string {
  if (tone === "broken") return "failed upstream";
  if (tone === "active") return "upstream active";
  if (tone === "unknown") return "upstream unknown";
  return "satisfied upstream";
}

function labelFor(total: number, satisfied: number, broken: number, unknown: number): string {
  if (!total) return "no chains";
  if (broken) return `${total} audited / ${broken} broken`;
  if (unknown) return `${total} audited / ${unknown} unknown`;
  return `${total} audited / ${satisfied} satisfied upstream`;
}

function headlineFor(total: number, satisfied: number, active: number, unknown: number, broken: number): string {
  if (!total) return "No dependency chains are visible in the current queue filters.";
  if (broken) return `${broken} dependency chain${broken === 1 ? "" : "s"} cannot satisfy from recent afterok evidence.`;
  if (unknown) return `${unknown} dependency chain${unknown === 1 ? "" : "s"} point outside visible queue and recent accounting evidence.`;
  if (active) return `${active} dependency chain${active === 1 ? "" : "s"} are waiting on upstream jobs that are still live.`;
  return `${satisfied} dependency gate${satisfied === 1 ? " has" : "s have"} recent accounting evidence; verify stale dependency state before changing resources.`;
}

function isDependencyJob(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend/.test(reason);
}

function isFailed(state: string | null): boolean {
  return Boolean(state && !["COMPLETED", "COMPLETING", "RUNNING"].some((ok) => state.toUpperCase().includes(ok)));
}

function baseId(value: string): string {
  return value.match(/^\d+/)?.[0] ?? value;
}

function commandFor(alias: string, jobId: string, blockers: string[]): string {
  const blockerIds = blockers.slice(0, 20).join(",");
  const historyProbe = blockerIds
    ? `; sacct -j ${blockerIds} --format=JobID,JobName,State,ExitCode,Start,End -P; squeue -j ${blockerIds} -o "%i|%j|%T|%M|%R"`
    : "";
  return `ssh ${alias} ${shellQuote(`scontrol show job -dd ${jobId}${historyProbe}`)}`;
}

function compareItems(left: DependencyAuditItem, right: DependencyAuditItem): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: DependencyAuditTone): number {
  return { satisfied: 0, active: 1, unknown: 2, broken: 3 }[tone];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
