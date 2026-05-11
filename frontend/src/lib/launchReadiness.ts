import type { AccountLimits, GpuPool, HistoryResponse, QueueJob, StorageResponse } from "../types";

export type LaunchReadinessStatus = "go" | "watch" | "fix";

export type LaunchCheck = {
  id: string;
  label: string;
  status: LaunchReadinessStatus;
  value: string;
  detail: string;
};

export type LaunchReadiness = {
  status: LaunchReadinessStatus;
  label: string;
  headline: string;
  command: string;
  checks: LaunchCheck[];
};

export function buildLaunchReadiness({
  gpuPools,
  jobs,
  history,
  storage,
  accountLimits,
  alias
}: {
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  accountLimits: AccountLimits | null;
  alias: string;
}): LaunchReadiness {
  const checks = [
    gpuCheck(gpuPools, jobs),
    queueCheck(gpuPools, jobs),
    storageCheck(storage),
    policyCheck(accountLimits, jobs),
    historyCheck(history)
  ];
  const status = overall(checks);
  return {
    status,
    label: labelFor(status),
    headline: headlineFor(status, checks),
    command: preflightCommand(alias),
    checks
  };
}

function gpuCheck(pools: GpuPool[], jobs: QueueJob[]): LaunchCheck {
  const usable = pools.reduce((sum, pool) => sum + pool.usable, 0);
  const largest = pools.slice().sort((left, right) => right.usable - left.usable)[0];
  const pendingGpu = pendingGpuCount(jobs);
  const status: LaunchReadinessStatus = usable === 0 && pendingGpu > 0 ? "fix" : pendingGpu > usable ? "watch" : "go";
  return {
    id: "gpu",
    label: "GPU fit",
    status,
    value: `${usable} usable`,
    detail: largest
      ? `${largest.type} leads with ${largest.usable} usable GPU; ${pendingGpu} GPU are pending in view.`
      : "No GPU pool is visible; keep this launch CPU-only or wait for inventory."
  };
}

function queueCheck(pools: GpuPool[], jobs: QueueJob[]): LaunchCheck {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const pendingGpu = pendingGpuCount(jobs);
  const usable = pools.reduce((sum, pool) => sum + pool.usable, 0);
  const status: LaunchReadinessStatus = pending.length >= 20 || pendingGpu > Math.max(usable * 2, 4) ? "watch" : "go";
  return {
    id: "queue",
    label: "Queue pressure",
    status,
    value: `${pending.length} pending`,
    detail: pendingGpu ? `${pendingGpu} pending GPU request(s) are ahead or nearby in the visible queue.` : "No pending GPU pressure is visible in this scope."
  };
}

function storageCheck(storage: StorageResponse | null): LaunchCheck {
  const volumes = storage?.volumes ?? [];
  if (!volumes.length) {
    return {
      id: "storage",
      label: "Storage",
      status: "watch",
      value: "not checked",
      detail: "Quota output is unavailable; run the quota probe before staging data or checkpoints."
    };
  }
  const worst = volumes.slice().sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
  const status: LaunchReadinessStatus = worst.severity === "critical" ? "fix" : worst.severity === "warning" ? "watch" : "go";
  return {
    id: "storage",
    label: "Storage",
    status,
    value: `${worst.name} ${worst.percent_used ?? "n/a"}%`,
    detail: status === "fix" ? `${worst.name} is critical; clean storage before launching checkpoint-heavy work.` : `${worst.name} quota is the tightest parsed storage signal.`
  };
}

function policyCheck(accountLimits: AccountLimits | null, jobs: QueueJob[]): LaunchCheck {
  if (!accountLimits?.qos.length) {
    return {
      id: "policy",
      label: "Policy",
      status: "watch",
      value: "unknown",
      detail: "Account and QOS limits are unavailable; verify caps before large submissions."
    };
  }
  const visibleJobs = jobs.filter((job) => ["PENDING", "RUNNING", "CONFIGURING"].includes(job.state) && (!accountLimits.user || job.user === accountLimits.user)).length;
  const normal = accountLimits.qos.find((qos) => qos.name === "normal") ?? accountLimits.qos[0];
  const cap = Math.min(limitOrInfinity(normal.max_jobs_per_user), limitOrInfinity(normal.max_submit_per_user));
  const afterSubmit = visibleJobs + 1;
  const status: LaunchReadinessStatus = Number.isFinite(cap) && afterSubmit > cap ? "fix" : Number.isFinite(cap) && afterSubmit >= cap * 0.85 ? "watch" : "go";
  return {
    id: "policy",
    label: "Policy",
    status,
    value: Number.isFinite(cap) ? `${afterSubmit}/${cap}` : `${afterSubmit} active`,
    detail: `${normal.name} QOS ${status === "go" ? "leaves room" : "is tight"} for one more visible submission.`
  };
}

function historyCheck(history: HistoryResponse | null): LaunchCheck {
  const jobs = history?.jobs ?? [];
  if (!jobs.length) {
    return {
      id: "history",
      label: "Recent runs",
      status: "watch",
      value: "no data",
      detail: "Accounting history is unavailable; launch small before scaling."
    };
  }
  const failures = jobs.filter((job) => !["COMPLETED", "RUNNING"].includes(job.state)).length;
  const cleanRate = Math.round(((jobs.length - failures) / jobs.length) * 100);
  return {
    id: "history",
    label: "Recent runs",
    status: cleanRate < 70 ? "watch" : "go",
    value: `${cleanRate}% clean`,
    detail: cleanRate < 70 ? `Recent runs are ${cleanRate}% clean; inspect failures before scaling.` : "Recent accounting does not show a major failure pattern."
  };
}

function overall(checks: LaunchCheck[]): LaunchReadinessStatus {
  if (checks.some((check) => check.status === "fix")) return "fix";
  if (checks.some((check) => check.status === "watch")) return "watch";
  return "go";
}

function labelFor(status: LaunchReadinessStatus): string {
  if (status === "fix") return "fix before launch";
  if (status === "watch") return "launch carefully";
  return "clear to launch";
}

function headlineFor(status: LaunchReadinessStatus, checks: LaunchCheck[]): string {
  const blocker = checks.find((check) => check.status === "fix");
  if (blocker) return `${blocker.label} needs attention before the next serious run.`;
  const watch = checks.find((check) => check.status === "watch");
  if (watch) return `${watch.label} is the main preflight risk for the next launch.`;
  return "Visible queue, policy, storage, and recent-history signals look launchable.";
}

function pendingGpuCount(jobs: QueueJob[]): number {
  return jobs.filter((job) => job.state === "PENDING").reduce((sum, job) => sum + job.gpu_count, 0);
}

function severityRank(severity: "info" | "warning" | "critical"): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function limitOrInfinity(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

function preflightCommand(alias: string): string {
  return `ssh ${alias} 'acct-chk "$USER"; squeue -u "$USER" -o "%i|%j|%P|%t|%M|%l|%C|%m|%b|%R"; sinfo -o "%P|%a|%D|%t|%G" | head -40'`;
}
