import type { GpuPool, HistoryResponse, StorageResponse } from "../types";

export type RunStampStatus = "go" | "watch" | "fix";

export type RunStampCheck = {
  id: string;
  label: string;
  status: RunStampStatus;
  value: string;
  detail: string;
};

export type RunStamp = {
  status: RunStampStatus;
  label: string;
  headline: string;
  checks: RunStampCheck[];
  snippet: string;
};

export function buildRunStamp({
  history,
  storage,
  gpuPools
}: {
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  gpuPools: GpuPool[];
}): RunStamp {
  const checks = [cudaCheck(history, gpuPools), pythonCheck(history), storageCheck(storage), slurmCheck()];
  const status = overall(checks);
  return {
    status,
    label: labelFor(status),
    headline: headlineFor(checks, status),
    checks,
    snippet: stampSnippet()
  };
}

function cudaCheck(history: HistoryResponse | null, gpuPools: GpuPool[]): RunStampCheck {
  const gpuFailures = (history?.jobs ?? []).filter((job) => requestedGpu(job) > 0 && job.state !== "COMPLETED").length;
  const hasGpu = gpuPools.some((pool) => pool.total > 0);
  const status: RunStampStatus = gpuFailures ? "watch" : hasGpu ? "go" : "watch";
  return {
    id: "cuda",
    label: "CUDA + modules",
    status,
    value: gpuFailures ? `${gpuFailures} GPU failure${gpuFailures === 1 ? "" : "s"}` : hasGpu ? "GPU visible" : "no GPU rows",
    detail: gpuFailures
      ? "Stamp module list, CUDA visibility, nvidia-smi, and GPU accounting before training."
      : "Capture module and CUDA context so successful runs become reusable baselines."
  };
}

function pythonCheck(history: HistoryResponse | null): RunStampCheck {
  const failures = (history?.jobs ?? []).filter((job) => job.state !== "COMPLETED").length;
  return {
    id: "python",
    label: "Python + git",
    status: failures ? "watch" : "go",
    value: failures ? "capture commit" : "baseline",
    detail: failures
      ? "Recent failures make package freeze and git commit mandatory evidence."
      : "Keep package freeze and git commit in every serious run log."
  };
}

function storageCheck(storage: StorageResponse | null): RunStampCheck {
  const volumes = storage?.volumes ?? [];
  const worst = volumes.slice().sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
  if (!worst) {
    return {
      id: "storage",
      label: "Storage + quota",
      status: "watch",
      value: "unknown",
      detail: "Quota data is missing; stamp acct-chk output before writing environments, logs, or checkpoints."
    };
  }
  const pressure = worst.percent_used ?? worst.file_percent_used ?? null;
  return {
    id: "storage",
    label: "Storage + quota",
    status: worst.severity === "critical" ? "fix" : worst.severity === "warning" ? "watch" : "go",
    value: `${worst.name} ${pressure ?? "n/a"}%`,
    detail: worst.severity === "critical"
      ? "Quota pressure can turn environment writes, logs, or checkpoints into misleading job failures."
      : "Stamp quota output so storage pressure is visible when debugging."
  };
}

function slurmCheck(): RunStampCheck {
  return {
    id: "slurm",
    label: "Slurm envelope",
    status: "go",
    value: "job env",
    detail: "Capture job ID, host, allocation TRES, submit directory, and selected Slurm variables."
  };
}

function headlineFor(checks: RunStampCheck[], status: RunStampStatus): string {
  const gpu = checks.find((check) => check.id === "cuda");
  const storage = checks.find((check) => check.id === "storage");
  if (status === "fix" && gpu?.status === "watch" && storage) {
    return `Recent GPU failure plus ${storage.value} storage pressure make in-job environment capture mandatory.`;
  }
  if (status === "fix") return `${storage?.label ?? "Storage"} must be stamped before another serious launch.`;
  if (status === "watch") return "Recent run evidence is incomplete; stamp the next job before scaling.";
  return "Run stamp is ready for serious launches and clean baselines.";
}

function labelFor(status: RunStampStatus): string {
  if (status === "fix") return "fix stamp";
  if (status === "watch") return "stamp advised";
  return "stamp ready";
}

function overall(checks: RunStampCheck[]): RunStampStatus {
  if (checks.some((check) => check.status === "fix")) return "fix";
  if (checks.some((check) => check.status === "watch")) return "watch";
  return "go";
}

function requestedGpu(job: HistoryResponse["jobs"][number]): number {
  return Number(job.requested_tres["gres/gpu"] ?? job.allocated_tres["gres/gpu"] ?? job.requested_tres.gpu ?? job.allocated_tres.gpu ?? 0) || 0;
}

function severityRank(severity: "info" | "warning" | "critical"): number {
  if (severity === "critical") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function stampSnippet(): string {
  return `# --- Andromeda run stamp: paste near the top of an sbatch script ---
STAMP_DIR="\${SLURM_SUBMIT_DIR:-$PWD}/run-stamps"
mkdir -p "$STAMP_DIR"
STAMP_FILE="$STAMP_DIR/\${SLURM_JOB_ID:-manual}-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "== job =="
  date -Is
  hostname
  whoami
  pwd
  echo "SLURM_JOB_ID=\${SLURM_JOB_ID:-manual}"
  echo "SLURM_SUBMIT_DIR=\${SLURM_SUBMIT_DIR:-unknown}"
  echo "== slurm env =="
  env | sort | grep -E '^(SLURM|CUDA|CONDA|VIRTUAL_ENV|PYTHONPATH)=' || true
  echo "== modules =="
  module list 2>&1 || true
  echo "== git =="
  git rev-parse --show-toplevel 2>/dev/null || true
  git rev-parse HEAD 2>/dev/null || true
  git status --short 2>/dev/null || true
  echo "== python =="
  python -V 2>&1 || true
  python -m pip freeze 2>/dev/null || true
  echo "== cuda =="
  nvidia-smi 2>/dev/null || true
  echo "== quota =="
  acct-chk "$USER" 2>/dev/null || true
} > "$STAMP_FILE" 2>&1
echo "run stamp: $STAMP_FILE"`;
}
