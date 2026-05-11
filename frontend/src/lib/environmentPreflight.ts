import type { GpuPool, HistoryResponse, StorageResponse } from "../types";

export type EnvStatus = "go" | "watch" | "fix";

export type EnvCheck = {
  id: string;
  label: string;
  status: EnvStatus;
  value: string;
  detail: string;
};

export type EnvironmentPreflight = {
  status: EnvStatus;
  label: string;
  headline: string;
  command: string;
  checks: EnvCheck[];
};

export function buildEnvironmentPreflight({
  history,
  storage,
  gpuPools,
  alias
}: {
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  gpuPools: GpuPool[];
  alias: string;
}): EnvironmentPreflight {
  const checks = [
    cudaFailureCheck(history),
    cudaAccountingCheck(history, gpuPools),
    environmentStorageCheck(storage),
    reproducibilityCheck(history)
  ];
  const status = overall(checks);
  return {
    status,
    label: labelFor(status),
    headline: headlineFor(status, checks),
    command: commandFor(alias),
    checks
  };
}

function cudaFailureCheck(history: HistoryResponse | null): EnvCheck {
  const failed = (history?.jobs ?? []).filter((job) => requestedGpu(job) > 0 && job.state !== "COMPLETED").length;
  return {
    id: "cuda-failures",
    label: "CUDA risk",
    status: failed ? "watch" : "go",
    value: failed ? `${failed} GPU failure${failed === 1 ? "" : "s"}` : "clean",
    detail: failed
      ? "Recent GPU failures make CUDA/module validation mandatory before scaling."
      : "Recent GPU jobs do not show a visible CUDA failure pattern."
  };
}

function cudaAccountingCheck(history: HistoryResponse | null, gpuPools: GpuPool[]): EnvCheck {
  const gpuJobs = (history?.jobs ?? []).filter((job) => requestedGpu(job) > 0);
  const missing = gpuJobs.filter((job) => !hasCudaCounters(job)).length;
  const status: EnvStatus = gpuPools.length && !gpuJobs.length ? "watch" : missing && missing === gpuJobs.length ? "watch" : "go";
  return {
    id: "cuda-accounting",
    label: "GPU counters",
    status,
    value: gpuJobs.length ? `${gpuJobs.length - missing}/${gpuJobs.length}` : "no rows",
    detail: gpuJobs.length
      ? `${gpuJobs.length - missing} recent GPU job(s) exposed CUDA utilization or memory counters.`
      : "No recent GPU accounting rows are available; run a smoke test before a full training launch."
  };
}

function environmentStorageCheck(storage: StorageResponse | null): EnvCheck {
  const volumes = storage?.volumes ?? [];
  if (!volumes.length) {
    return {
      id: "storage-env",
      label: "Env writes",
      status: "watch",
      value: "unknown",
      detail: "Quota output is unavailable; validate home and scratch before creating environments or logs."
    };
  }
  const critical = volumes.find((volume) => volume.severity === "critical");
  const fileRisk = volumes.find((volume) => (volume.file_percent_used ?? 0) >= 85);
  const status: EnvStatus = critical ? "fix" : fileRisk ? "watch" : "go";
  const volume = critical ?? fileRisk ?? volumes[0];
  const pressure = critical ? volume.percent_used ?? volume.file_percent_used : volume.file_percent_used ?? volume.percent_used;
  return {
    id: "storage-env",
    label: "Env writes",
    status,
    value: `${volume.name} ${pressure ?? "n/a"}%`,
    detail: status === "fix"
      ? "Storage can break virtualenvs, caches, logs, or checkpoints before Slurm explains the failure."
      : status === "watch"
        ? `${volume.name} file pressure can break package installs and job logs.`
        : "Parsed quotas do not show an environment-write blocker."
  };
}

function reproducibilityCheck(history: HistoryResponse | null): EnvCheck {
  const recentFailures = (history?.jobs ?? []).filter((job) => job.state !== "COMPLETED").length;
  return {
    id: "repro",
    label: "Run stamp",
    status: recentFailures ? "watch" : "go",
    value: recentFailures ? "required" : "ready",
    detail: recentFailures
      ? "Capture modules, Python packages, git commit, and CUDA visibility in the next run log."
      : "Keep module list, package freeze, git commit, and nvidia-smi in launch logs."
  };
}

function overall(checks: EnvCheck[]): EnvStatus {
  if (checks.some((check) => check.status === "fix")) return "fix";
  if (checks.some((check) => check.status === "watch")) return "watch";
  return "go";
}

function labelFor(status: EnvStatus): string {
  if (status === "fix") return "fix environment";
  if (status === "watch") return "validate environment";
  return "environment ready";
}

function headlineFor(status: EnvStatus, checks: EnvCheck[]): string {
  const blocker = checks.find((check) => check.status === "fix");
  if (blocker) return `${blocker.label} must be fixed before a serious launch.`;
  const watch = checks.find((check) => check.status === "watch");
  if (watch) return `${watch.label} needs validation before scaling.`;
  return "Recent module, CUDA, storage, and reproducibility signals look launchable.";
}

function requestedGpu(job: HistoryResponse["jobs"][number]): number {
  return Number(job.requested_tres["gres/gpu"] ?? job.requested_tres.gpu ?? job.allocated_tres["gres/gpu"] ?? job.allocated_tres.gpu ?? 0) || 0;
}

function hasCudaCounters(job: HistoryResponse["jobs"][number]): boolean {
  const text = Object.keys({ ...job.tres_usage_in_ave, ...job.tres_usage_in_max }).join(" ").toLowerCase();
  return /gpuutil|gpumem|gpu_util|gpu_mem/.test(text);
}

function commandFor(alias: string): string {
  return `ssh ${alias} 'module list 2>&1; module avail cuda 2>&1 | head -80; python - <<'"'"'PY'"'"'\nimport os,sys,platform,subprocess\nprint("python", sys.version.replace("\\n", " "))\nprint("platform", platform.platform())\nsubprocess.run([sys.executable, "-m", "pip", "freeze"], check=False)\nPY\nnvidia-smi 2>/dev/null || true; acct-chk "$USER"'`;
}
