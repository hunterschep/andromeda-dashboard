import type { AccountLimits, GpuPool, HistoryResponse, QueueJob, StorageResponse } from "../types";
import type { PlannerInput, PlannerResult } from "./requestPlanner";

export type NextLaunchStatus = "go" | "watch" | "blocked";

export type NextLaunchRow = {
  id: string;
  label: string;
  status: NextLaunchStatus;
  value: string;
  detail: string;
};

export type NextLaunchImpact = {
  status: NextLaunchStatus;
  label: string;
  headline: string;
  command: string;
  rows: NextLaunchRow[];
};

export function buildNextLaunchImpact({
  input,
  result,
  gpuPools,
  jobs,
  history,
  storage,
  accountLimits,
  alias
}: {
  input: PlannerInput;
  result: PlannerResult | null;
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  accountLimits: AccountLimits | null;
  alias: string;
}): NextLaunchImpact {
  const rows = [
    shapeRow(input, result),
    queueRow(input, gpuPools, jobs),
    fairshareRow(input, history),
    storageRow(input, storage),
    policyRow(accountLimits, jobs)
  ];
  const status = rows.reduce<NextLaunchStatus>((current, row) => worse(current, row.status), "go");
  return {
    status,
    label: labelFor(status),
    headline: headlineFor(status, rows),
    command: commandFor(alias),
    rows
  };
}

function shapeRow(input: PlannerInput, result: PlannerResult | null): NextLaunchRow {
  const gpuHours = input.gpus * input.hours;
  const cpuHours = input.cpus * input.hours;
  return {
    id: "shape",
    label: "planned shape",
    status: result?.status === "blocked" ? "blocked" : result?.status === "wait" ? "watch" : "go",
    value: `${hours(gpuHours)} GPU-h`,
    detail: `${input.gpus} GPU / ${input.cpus} CPU / ${input.memoryGb} GB for ${input.hours}h on ${result?.partition ?? "auto"} adds ${hours(cpuHours)} CPU-h.`
  };
}

function queueRow(input: PlannerInput, pools: GpuPool[], jobs: QueueJob[]): NextLaunchRow {
  const pendingGpu = jobs.filter((job) => job.state === "PENDING").reduce((sum, job) => sum + job.gpu_count, 0);
  const usableGpu = pools.reduce((sum, pool) => sum + pool.usable, 0);
  const after = pendingGpu + input.gpus;
  const shortfall = Math.max(0, after - usableGpu);
  return {
    id: "queue",
    label: "queue pressure",
    status: shortfall > 0 ? "watch" : "go",
    value: `${pendingGpu} -> ${after} GPU waiting`,
    detail: shortfall ? `visible GPU demand would exceed usable supply by ${shortfall}.` : "visible usable GPU supply covers this additional request on paper."
  };
}

function fairshareRow(input: PlannerInput, history: HistoryResponse | null): NextLaunchRow {
  const recent = (history?.jobs ?? []).reduce((sum, job) => sum + recentGpuHours(job), 0);
  const planned = input.gpus * input.hours;
  const projected = recent + planned;
  return {
    id: "fairshare",
    label: "fairshare burn",
    status: projected >= 12 ? "watch" : "go",
    value: `${hours(projected)} projected GPU-h`,
    detail: `this launch adds ${hours(planned)} GPU-h to ${hours(recent)} recent accounted GPU-h.`
  };
}

function storageRow(input: PlannerInput, storage: StorageResponse | null): NextLaunchRow {
  const worst = storage?.volumes?.slice().sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
  if (!worst) {
    return { id: "storage", label: "storage", status: "watch", value: "not checked", detail: "quota data is unavailable; run acct-chk before launching." };
  }
  const status = worst.severity === "critical" ? "blocked" : worst.severity === "warning" ? "watch" : "go";
  const checkpointHint = input.gpus ? "checkpoint-heavy GPU run" : "new run";
  return {
    id: "storage",
    label: "storage",
    status,
    value: `${worst.name} ${worst.percent_used ?? "n/a"}%`,
    detail: status === "blocked" ? `${worst.name} is critical; clean it before adding a ${checkpointHint}.` : `${worst.name} is the tightest parsed quota signal.`
  };
}

function policyRow(accountLimits: AccountLimits | null, jobs: QueueJob[]): NextLaunchRow {
  if (!accountLimits?.qos.length) {
    return { id: "policy", label: "policy", status: "watch", value: "unknown", detail: "visible account/QOS limits are unavailable." };
  }
  const qos = accountLimits.qos.find((item) => item.name === "normal") ?? accountLimits.qos[0];
  const active = jobs.filter((job) => ["PENDING", "RUNNING", "CONFIGURING"].includes(job.state) && (!accountLimits.user || job.user === accountLimits.user)).length + 1;
  const cap = Math.min(limitOrInfinity(qos.max_jobs_per_user), limitOrInfinity(qos.max_submit_per_user));
  const status = Number.isFinite(cap) && active > cap ? "blocked" : Number.isFinite(cap) && active >= cap * 0.85 ? "watch" : "go";
  return {
    id: "policy",
    label: "policy",
    status,
    value: Number.isFinite(cap) ? `${active}/${cap}` : `${active} active`,
    detail: `${qos.name} QOS ${status === "go" ? "remains clear" : "is tight"} at ${Number.isFinite(cap) ? `${active}/${cap}` : `${active} visible jobs`}.`
  };
}

function headlineFor(status: NextLaunchStatus, rows: NextLaunchRow[]): string {
  const blocker = rows.find((row) => row.status === "blocked");
  if (blocker) return `${blocker.label} blocks the next serious launch before Slurm placement matters.`;
  const watch = rows.find((row) => row.status === "watch");
  if (watch) return `${watch.label} is the main impact of one more launch.`;
  return "One more launch looks acceptable against visible queue, policy, storage, and recent usage.";
}

function labelFor(status: NextLaunchStatus): string {
  if (status === "blocked") return "blocked impact";
  if (status === "watch") return "watch impact";
  return "low impact";
}

function commandFor(alias: string): string {
  return `ssh ${alias} 'acct-chk "$USER"; squeue -u "$USER" -o "%i|%j|%P|%t|%M|%l|%C|%m|%b|%R"; sacct -u "$USER" --starttime=now-7days --format=JobID,State,Elapsed,AllocTRES -P'`;
}

function recentGpuHours(job: { allocated_tres?: Record<string, string>; requested_tres?: Record<string, string>; runtime_seconds: number | null }): number {
  const source = job.allocated_tres?.["gres/gpu"] ? job.allocated_tres : job.requested_tres;
  const gpu = Number(source?.["gres/gpu"] ?? source?.gpu ?? 0) || 0;
  return gpu * ((job.runtime_seconds ?? 0) / 3600);
}

function severityRank(severity: "info" | "warning" | "critical"): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function limitOrInfinity(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

function worse(left: NextLaunchStatus, right: NextLaunchStatus): NextLaunchStatus {
  return statusRank(left) >= statusRank(right) ? left : right;
}

function statusRank(status: NextLaunchStatus): number {
  return status === "blocked" ? 2 : status === "watch" ? 1 : 0;
}

function hours(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString();
  return value.toFixed(value >= 10 ? 1 : 2);
}
