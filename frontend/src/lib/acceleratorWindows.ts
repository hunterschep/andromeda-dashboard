import { formatDuration } from "../api";
import type { GpuPool, NodeResource, QueueJob } from "../types";

export type AcceleratorWindowTone = "open" | "wait" | "gate" | "scarce";

export type AcceleratorWindowRow = {
  type: string;
  tone: AcceleratorWindowTone;
  window: string;
  usable: number;
  waiting: number;
  gated: number;
  running: number;
  nextReturn: string;
  summary: string;
  action: string;
  command: string;
};

export type AcceleratorWindows = {
  label: string;
  headline: string;
  rows: AcceleratorWindowRow[];
};

type Family = {
  type: string;
  usable: number;
  total: number;
  waiting: number;
  gated: number;
  running: number;
  nextReturnSeconds: number | null;
};

export function buildAcceleratorWindows(
  nodes: NodeResource[],
  pools: GpuPool[],
  jobs: QueueJob[],
  alias: string,
  nowMs = Date.now()
): AcceleratorWindows {
  const families = new Map<string, Family>();
  for (const node of nodes) {
    for (const gpu of node.gres) ensure(families, gpu.type).total += gpu.total;
  }
  for (const pool of pools) {
    const family = ensure(families, pool.type);
    family.usable = Math.max(family.usable, pool.usable);
    family.total = Math.max(family.total, pool.total);
  }
  for (const job of jobs) {
    if (job.gpu_count <= 0) continue;
    for (const request of requests(job)) applyJob(ensure(families, request.type), job, request.count, nowMs);
  }
  const rows = Array.from(families.values()).map((family) => rowFor(family, alias)).filter((row) => row.usable || row.waiting || row.running).sort(compareRows);
  const active = rows.filter((row) => row.tone !== "open").length;
  return {
    label: `${active} constrained / ${rows.length} famil${rows.length === 1 ? "y" : "ies"}`,
    headline: headline(rows),
    rows
  };
}

function applyJob(family: Family, job: QueueJob, count: number, nowMs: number) {
  if (job.state === "PENDING") {
    family.waiting += count;
    family.gated += isGated(job) ? count : 0;
    return;
  }
  if (job.state !== "RUNNING" && job.state !== "COMPLETING") return;
  family.running += count;
  const seconds = releaseSeconds(job, nowMs);
  if (seconds !== null) family.nextReturnSeconds = family.nextReturnSeconds === null ? seconds : Math.min(family.nextReturnSeconds, seconds);
}

function rowFor(family: Family, alias: string): AcceleratorWindowRow {
  const ungated = Math.max(0, family.waiting - family.gated);
  const tone = toneFor(family, ungated);
  return {
    type: family.type,
    tone,
    window: windowFor(tone),
    usable: family.usable,
    waiting: family.waiting,
    gated: family.gated,
    running: family.running,
    nextReturn: family.nextReturnSeconds === null ? "undated" : formatDuration(family.nextReturnSeconds),
    summary: summaryFor(family, ungated, tone),
    action: actionFor(family, ungated, tone),
    command: commandFor(alias, family.type)
  };
}

function toneFor(family: Family, ungated: number): AcceleratorWindowTone {
  if (family.gated >= family.waiting && family.waiting > 0) return "gate";
  if (ungated > family.usable && family.nextReturnSeconds !== null) return "wait";
  if (ungated > family.usable) return "scarce";
  return "open";
}

function headline(rows: AcceleratorWindowRow[]): string {
  if (!rows.length) return "No accelerator window can be built from this snapshot.";
  const gate = rows.find((row) => row.tone === "gate");
  if (gate) return `${gate.type} demand is scheduler-gated; capacity changes will not matter until that gate clears.`;
  const scarce = rows.find((row) => row.tone === "scarce" || row.tone === "wait");
  if (scarce) return `${scarce.type} is the tightest accelerator window: ${scarce.waiting} waiting against ${scarce.usable} usable.`;
  return "Visible accelerator windows are open enough for short validation work.";
}

function summaryFor(family: Family, ungated: number, tone: AcceleratorWindowTone): string {
  if (tone === "gate") return `${family.waiting} ${family.type} GPU request${plural(family.waiting)} are gated before capacity can matter.`;
  if (tone === "wait") return `${ungated} ungated ${family.type} GPU request${plural(ungated)} exceed current usable supply, but a dated return exists.`;
  if (tone === "scarce") return `${ungated} ungated ${family.type} GPU request${plural(ungated)} exceed ${family.usable} usable GPU with no dated return.`;
  return `${family.usable} ${family.type} GPU${plural(family.usable)} are usable now against ${ungated} ungated request${plural(ungated)}.`;
}

function actionFor(family: Family, ungated: number, tone: AcceleratorWindowTone): string {
  if (tone === "gate") return "Resolve dependency, hold, or begin-time fields before changing GPU width.";
  if (tone === "wait") return `Hold wide work until the next ${family.type} return or split into one-GPU probes.`;
  if (tone === "scarce") return "Avoid widening the queue; split or use a smaller validation run.";
  if (ungated) return "A short launch can fit on paper; still verify storage and environment first.";
  return "Good window for a short GPU smoke test if the experiment is ready.";
}

function windowFor(tone: AcceleratorWindowTone): string {
  if (tone === "gate") return "clear gates";
  if (tone === "wait") return "wait for return";
  if (tone === "scarce") return "split first";
  return "launchable";
}

function requests(job: QueueJob): { type: string; count: number }[] {
  if (job.gpus.length) return job.gpus.map((gpu) => ({ type: gpu.type, count: gpu.count }));
  return [{ type: "generic", count: job.gpu_count }];
}

function releaseSeconds(job: QueueJob, nowMs: number): number | null {
  const end = job.end_time ? Date.parse(job.end_time) : Number.NaN;
  if (Number.isFinite(end) && end > nowMs) return Math.round((end - nowMs) / 1000);
  if (job.time_limit_seconds !== null && job.elapsed_seconds !== null) return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
  return null;
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function ensure(families: Map<string, Family>, type: string): Family {
  const existing = families.get(type);
  if (existing) return existing;
  const created = { type, usable: 0, total: 0, waiting: 0, gated: 0, running: 0, nextReturnSeconds: null };
  families.set(type, created);
  return created;
}

function compareRows(left: AcceleratorWindowRow, right: AcceleratorWindowRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.waiting - left.waiting || left.type.localeCompare(right.type);
}

function toneRank(tone: AcceleratorWindowTone): number {
  return { open: 0, wait: 1, scarce: 2, gate: 3 }[tone];
}

function commandFor(alias: string, type: string): string {
  const family = type.replace(/'/g, "'\\''");
  return `ssh ${alias} 'sinfo -Nel -o "%N|%t|%G|%P|%m|%C|%E" | grep -i -- "${family}"; squeue -t R,PD -O JobID:12,Name:24,UserName:16,State:12,Reason:28,TresPerNode:24,EndTime:22,NodeList:24 | grep -i -- "${family}" || true'`;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
