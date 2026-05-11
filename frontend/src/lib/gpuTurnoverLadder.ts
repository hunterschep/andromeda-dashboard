import { formatDuration } from "../api";
import type { GpuPool, QueueJob } from "../types";

export type GpuTurnoverStepId = "now" | "returning" | "dated" | "gated" | "dark";

export type GpuTurnoverStep = {
  id: GpuTurnoverStepId;
  label: string;
  value: string;
  count: number;
  tone: "open" | "return" | "demand" | "blocked" | "unknown";
  detail: string;
};

export type GpuTurnoverRow = {
  type: string;
  label: string;
  headline: string;
  steps: GpuTurnoverStep[];
};

export type GpuTurnoverLadder = {
  label: string;
  rows: GpuTurnoverRow[];
  command: string;
};

type Family = {
  type: string;
  now: number;
  returning: number;
  nextRelease: number | null;
  dated: number;
  gated: number;
  dark: number;
  undatedRunning: number;
};

export function buildGpuTurnoverLadder(pools: GpuPool[], jobs: QueueJob[], alias: string, nowMs = Date.now()): GpuTurnoverLadder {
  const families = new Map<string, Family>();
  for (const pool of pools) families.set(pool.type, base(pool.type, pool.usable));
  for (const job of jobs) {
    if (job.gpu_count <= 0) continue;
    for (const request of requests(job)) applyJob(family(families, request.type), job, request.count, nowMs);
  }
  const rows = Array.from(families.values()).map(rowFor).filter((row) => row.steps.some((step) => step.count > 0)).sort(compareRows);
  return {
    label: `${rows.length} GPU famil${rows.length === 1 ? "y" : "ies"}`,
    rows,
    command: `ssh ${alias} 'squeue -o "%i|%j|%T|%P|%M|%l|%b|%R|%S|%e" | sed -n "1,80p"'`
  };
}

function applyJob(target: Family, job: QueueJob, count: number, nowMs: number) {
  if (job.state === "RUNNING" || job.state === "COMPLETING") {
    const release = releaseSeconds(job, nowMs);
    if (release === null) target.undatedRunning += count;
    else {
      target.returning += count;
      target.nextRelease = target.nextRelease === null ? release : Math.min(target.nextRelease, release);
    }
    return;
  }
  if (job.state !== "PENDING") return;
  if (isGated(job)) target.gated += count;
  else if (job.estimated_start_time) target.dated += count;
  else target.dark += count;
}

function rowFor(item: Family): GpuTurnoverRow {
  const waiting = item.gated + item.dated + item.dark;
  return {
    type: item.type,
    label: `${item.now} now / ${item.returning} returning / ${waiting} waiting`,
    headline: headline(item),
    steps: [
      step("now", "free now", String(item.now), item.now, "open", `${item.now} ${item.type} GPU${plural(item.now)} can accept work immediately if policy and topology allow.`),
      step("returning", "known returns", releaseValue(item), item.returning, "return", releaseDetail(item)),
      step("dated", "dated starts", String(item.dated), item.dated, "demand", `${item.dated} ${item.type} GPU${plural(item.dated)} have public Slurm start estimates.`),
      step("gated", "gated demand", String(item.gated), item.gated, "blocked", `${item.gated} ${item.type} GPU${plural(item.gated)} are waiting behind dependency, hold, or begin-time gates.`),
      step("dark", "blind demand", String(item.dark), item.dark, "unknown", `${item.dark} ${item.type} GPU${plural(item.dark)} are pending without a public start estimate.`)
    ]
  };
}

function headline(item: Family): string {
  if (item.gated > 0) {
    return `${item.type} demand is gated: ${item.gated} GPU${plural(item.gated)} ${verb(item.gated, "is", "are")} blocked before release timing can help.`;
  }
  if (item.dark > item.now + item.returning) {
    return `${item.type} has ${item.dark} GPU${plural(item.dark)} in blind demand; probe priority before waiting on turnover.`;
  }
  if (item.returning) return `${item.returning} running ${item.type} GPU${plural(item.returning)} ${verb(item.returning, "is", "are")} projected to return; next known release is ${releaseValue(item)}.`;
  if (item.now) return `${item.now} ${item.type} GPU${plural(item.now)} are free now with no dated turnover needed.`;
  return `${item.type} has no visible free GPU or dated turnover.`;
}

function releaseDetail(item: Family): string {
  if (item.returning) return `${item.returning} running ${item.type} GPU${plural(item.returning)} ${verb(item.returning, "exposes", "expose")} a walltime-derived release.`;
  if (item.undatedRunning) return `${item.undatedRunning} running ${item.type} GPU${plural(item.undatedRunning)} lack enough timing data for release math.`;
  return `No running ${item.type} GPU exposes a future release.`;
}

function releaseValue(item: Family): string {
  return item.nextRelease === null ? "none" : formatDuration(item.nextRelease);
}

function releaseSeconds(job: QueueJob, nowMs: number): number | null {
  const end = job.end_time ? Date.parse(job.end_time) : Number.NaN;
  if (Number.isFinite(end) && end > nowMs) return Math.round((end - nowMs) / 1000);
  if (job.time_limit_seconds !== null && job.elapsed_seconds !== null) return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
  return null;
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function requests(job: QueueJob): { type: string; count: number }[] {
  if (job.gpus.length) return job.gpus.map((gpu) => ({ type: gpu.type, count: gpu.count }));
  return [{ type: "generic", count: job.gpu_count }];
}

function step(
  id: GpuTurnoverStepId,
  label: string,
  value: string,
  count: number,
  tone: GpuTurnoverStep["tone"],
  detail: string
): GpuTurnoverStep {
  return { id, label, value, count, tone, detail };
}

function family(families: Map<string, Family>, type: string): Family {
  const existing = families.get(type);
  if (existing) return existing;
  const created = base(type, 0);
  families.set(type, created);
  return created;
}

function base(type: string, now: number): Family {
  return { type, now, returning: 0, nextRelease: null, dated: 0, gated: 0, dark: 0, undatedRunning: 0 };
}

function compareRows(left: GpuTurnoverRow, right: GpuTurnoverRow): number {
  return risk(right) - risk(left) || left.type.localeCompare(right.type);
}

function risk(row: GpuTurnoverRow): number {
  const gated = row.steps.find((stepItem) => stepItem.id === "gated")?.count ?? 0;
  const dark = row.steps.find((stepItem) => stepItem.id === "dark")?.count ?? 0;
  const now = row.steps.find((stepItem) => stepItem.id === "now")?.count ?? 0;
  return gated * 3 + dark * 2 - now;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function verb(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}
