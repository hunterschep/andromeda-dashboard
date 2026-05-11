import type { GpuPool, HistoryResponse, PartitionSummary, QueueJob } from "../types";

export type PlannerInput = {
  partition: string;
  gpuType: string;
  gpus: number;
  cpus: number;
  memoryGb: number;
  hours: number;
};

export type PlannerResult = {
  partition: string;
  score: number;
  status: "ready" | "wait" | "blocked";
  waitBand: string;
  constraint: string;
  detail: string;
};

export type JupyterSessionPlan = {
  script: string;
  nodeCommand: string;
  tunnelCommand: string;
  openUrl: string;
};

export type SweepPlan = {
  script: string;
  submitCommand: string;
  shape: string;
};

export function defaultPlannerInput(gpuPools: GpuPool[], partitions: PartitionSummary[]): PlannerInput {
  return {
    partition: "auto",
    gpuType: gpuPools[0]?.type ?? "any",
    gpus: gpuPools.length ? 1 : 0,
    cpus: gpuPools.length ? 8 : 4,
    memoryGb: gpuPools.length ? 64 : 16,
    hours: 4
  };
}

export function planRequest({
  input,
  partitions,
  jobs,
  history
}: {
  input: PlannerInput;
  partitions: PartitionSummary[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
}): PlannerResult[] {
  return partitions
    .filter((partition) => input.partition === "auto" || partition.name === input.partition)
    .map((partition) => scorePartition(input, partition, jobs, history))
    .sort((left, right) => right.score - left.score || left.partition.localeCompare(right.partition));
}

export function sbatchForRequest(input: PlannerInput, result: PlannerResult | null): string {
  const partition = result?.partition ?? (input.partition === "auto" ? "short" : input.partition);
  const gres = input.gpus > 0 ? `#SBATCH --gres=gpu${input.gpuType !== "any" ? `:${input.gpuType}` : ""}:${input.gpus}\n` : "";
  return [
    "#!/bin/bash",
    "#SBATCH --job-name=andromeda-plan",
    `#SBATCH --partition=${partition}`,
    "#SBATCH --nodes=1",
    "#SBATCH --ntasks=1",
    `#SBATCH --cpus-per-task=${input.cpus}`,
    `#SBATCH --mem=${input.memoryGb}G`,
    `#SBATCH --time=${formatWalltime(input.hours)}`,
    `${gres}#SBATCH --output=logs/%x-%j.out`,
    "#SBATCH --error=logs/%x-%j.err",
    "",
    "set -euo pipefail",
    "cd \"$SLURM_SUBMIT_DIR\"",
    input.gpus > 0 ? "nvidia-smi" : "# replace with your workload",
    "python train.py"
  ].join("\n");
}

export function jupyterForRequest(input: PlannerInput, result: PlannerResult | null, alias: string): JupyterSessionPlan {
  const partition = result?.partition ?? (input.partition === "auto" ? "interactive" : input.partition);
  const port = 8888;
  return {
    script: [
      "#!/bin/bash",
      "#SBATCH --job-name=jupyter-andromeda",
      `#SBATCH --partition=${partition}`,
      "#SBATCH --nodes=1",
      "#SBATCH --ntasks=1",
      `#SBATCH --cpus-per-task=${input.cpus}`,
      `#SBATCH --mem=${input.memoryGb}G`,
      `#SBATCH --time=${formatWalltime(Math.min(input.hours, 12))}`,
      input.gpus > 0 ? `#SBATCH --gres=gpu${input.gpuType !== "any" ? `:${input.gpuType}` : ""}:${input.gpus}` : null,
      "#SBATCH --output=logs/%x-%j.out",
      "#SBATCH --error=logs/%x-%j.err",
      "",
      "set -euo pipefail",
      "cd \"$SLURM_SUBMIT_DIR\"",
      "mkdir -p logs",
      "echo \"node=$(hostname) port=8888\"",
      "module load python 2>/dev/null || true",
      `jupyter lab --no-browser --ip=0.0.0.0 --port=${port}`
    ].filter(Boolean).join("\n"),
    nodeCommand: `ssh ${alias} 'squeue -u "$USER" -n jupyter-andromeda -h -o "%N" | head -1'`,
    tunnelCommand: `ssh -N -L ${port}:<compute-node>:${port} ${alias}`,
    openUrl: `http://127.0.0.1:${port}`
  };
}

export function sweepForRequest(input: PlannerInput, result: PlannerResult | null): SweepPlan {
  const partition = result?.partition ?? (input.partition === "auto" ? "short" : input.partition);
  const gres = input.gpus > 0 ? `#SBATCH --gres=gpu${input.gpuType !== "any" ? `:${input.gpuType}` : ""}:${input.gpus}` : null;
  return {
    script: [
      "#!/bin/bash",
      "#SBATCH --job-name=andromeda-sweep",
      `#SBATCH --partition=${partition}`,
      "#SBATCH --array=0-31%8",
      "#SBATCH --nodes=1",
      "#SBATCH --ntasks=1",
      `#SBATCH --cpus-per-task=${input.cpus}`,
      `#SBATCH --mem=${input.memoryGb}G`,
      `#SBATCH --time=${formatWalltime(input.hours)}`,
      gres,
      "#SBATCH --output=logs/%x-%A_%a.out",
      "#SBATCH --error=logs/%x-%A_%a.err",
      "",
      "set -euo pipefail",
      "cd \"$SLURM_SUBMIT_DIR\"",
      "mkdir -p logs",
      "PARAM_FILE=${PARAM_FILE:-params.txt}",
      "if [[ -f \"$PARAM_FILE\" ]]; then",
      "  PARAMS=$(sed -n \"$((SLURM_ARRAY_TASK_ID + 1))p\" \"$PARAM_FILE\")",
      "else",
      "  PARAMS=\"--seed $SLURM_ARRAY_TASK_ID\"",
      "fi",
      input.gpus > 0 ? "nvidia-smi" : "# CPU-only sweep",
      "python train.py $PARAMS"
    ].filter(Boolean).join("\n"),
    submitCommand: "mkdir -p logs && sbatch sweep.sl",
    shape: "32 tasks / max 8 concurrent"
  };
}

function scorePartition(
  input: PlannerInput,
  partition: PartitionSummary,
  jobs: QueueJob[],
  history: HistoryResponse | null
): PlannerResult {
  const pending = jobs.filter((job) => job.state === "PENDING" && job.partition === partition.name);
  const pendingGpu = pending.reduce((sum, job) => sum + job.gpu_count, 0);
  const pendingCpu = pending.reduce((sum, job) => sum + job.cpus, 0);
  const maxSeconds = parseSlurmTime(partition.max_time);
  const requestedSeconds = input.hours * 3600;
  const memoryMb = input.memoryGb * 1024;
  const hardBlocks = [
    input.cpus > partition.cpus_total ? "CPU request exceeds partition inventory" : null,
    memoryMb > partition.memory_free_mb && partition.memory_free_mb > 0 ? "memory request exceeds visible free memory" : null,
    input.gpus > 0 && partition.gpu_total === 0 ? "partition has no GPUs" : null,
    input.gpus > partition.gpu_total && partition.gpu_total > 0 ? "GPU request exceeds partition inventory" : null,
    maxSeconds !== null && requestedSeconds > maxSeconds ? "walltime exceeds partition limit" : null
  ].filter(Boolean) as string[];

  if (hardBlocks.length) {
    return blockedResult(partition.name, hardBlocks[0]);
  }

  const gpuWait = input.gpus > partition.gpu_free && input.gpus > 0;
  const cpuWait = input.cpus > partition.cpus_idle;
  const backlog = pending.length + Math.ceil(pendingGpu / Math.max(partition.gpu_free || 1, 1));
  const status = gpuWait || cpuWait || backlog > 3 ? "wait" : "ready";
  const pressure = Math.min(100, Math.round(backlog * 12 + (pendingCpu / Math.max(partition.cpus_idle + pendingCpu, 1)) * 38));
  const score = Math.max(0, 100 - pressure - (gpuWait ? 24 : 0) - (cpuWait ? 18 : 0) + (partition.gpu_free >= input.gpus ? 8 : 0));
  const constraint = gpuWait ? "GPU turnover" : cpuWait ? "CPU headroom" : pending.length ? "queue backlog" : "fits current snapshot";
  return {
    partition: partition.name,
    score,
    status,
    waitBand: waitBand(status, pressure, history?.median_wait_seconds ?? null),
    constraint,
    detail: `${partition.cpus_idle.toLocaleString()} idle CPU, ${partition.gpu_free}/${partition.gpu_total} free GPU, ${pending.length} pending jobs`
  };
}

function blockedResult(partition: string, constraint: string): PlannerResult {
  return { partition, score: 0, status: "blocked", waitBand: "not eligible", constraint, detail: "Change the request or choose another partition." };
}

function waitBand(status: PlannerResult["status"], pressure: number, medianWaitSeconds: number | null) {
  if (status === "blocked") return "not eligible";
  if (status === "ready") return "now/backfill";
  if (pressure > 70) return "multi-hour";
  if (medianWaitSeconds && medianWaitSeconds > 3600) return "1h+";
  return "30-90m";
}

function parseSlurmTime(value: string | null): number | null {
  if (!value) return null;
  const [dayPart, timePart] = value.includes("-") ? value.split("-") : ["0", value];
  const parts = timePart.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = parts.length === 3 ? parts : [0, parts[0], parts[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function formatWalltime(hours: number): string {
  const wholeHours = Math.max(1, Math.floor(hours));
  return `${String(wholeHours).padStart(2, "0")}:00:00`;
}
