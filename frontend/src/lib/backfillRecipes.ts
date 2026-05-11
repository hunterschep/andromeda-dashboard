import type { GpuPool, PartitionSummary, QueueJob, SchedulerHealth, StorageResponse } from "../types";

export type BackfillRecipeStatus = "ready" | "watch" | "blocked";

export type BackfillRecipe = {
  id: string;
  title: string;
  status: BackfillRecipeStatus;
  signal: string;
  detail: string;
  snippet: string;
};

export type BackfillRecipes = {
  label: string;
  headline: string;
  recipes: BackfillRecipe[];
};

export function buildBackfillRecipes({
  partitions,
  gpuPools,
  jobs,
  storage,
  scheduler
}: {
  partitions: PartitionSummary[];
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  storage: StorageResponse | null;
  scheduler: SchedulerHealth | null;
}): BackfillRecipes {
  const recipes = [cpuFlash(partitions), gpuSmoke(partitions, gpuPools, jobs), gateAudit(jobs), storageGuard(storage)].filter(
    (recipe): recipe is BackfillRecipe => Boolean(recipe)
  );
  const ready = recipes.filter((recipe) => recipe.status === "ready").length;
  const watch = recipes.filter((recipe) => recipe.status === "watch").length;
  return {
    label: `${ready} ready / ${watch} watch`,
    headline: headlineFor(scheduler, recipes),
    recipes
  };
}

function cpuFlash(partitions: PartitionSummary[]): BackfillRecipe | null {
  const partition = [...partitions].sort((left, right) => right.cpus_idle - left.cpus_idle || left.name.localeCompare(right.name))[0];
  if (!partition) return null;
  const cpus = Math.min(4, Math.max(1, partition.cpus_idle));
  const ready = partition.cpus_idle >= 4;
  return {
    id: "cpu-flash",
    title: "CPU flash",
    status: ready ? "ready" : "watch",
    signal: `${partition.cpus_idle} idle CPU on ${partition.name}`,
    detail: ready
      ? `${partition.name} can absorb a tiny CPU validation job without widening the queue shape.`
      : `${partition.name} has limited idle CPU; shrink this recipe before submitting.`,
    snippet: [
      "#SBATCH --job-name=andromeda-cpu-flash",
      `#SBATCH --partition=${partition.name}`,
      "#SBATCH --nodes=1",
      "#SBATCH --ntasks=1",
      `#SBATCH --cpus-per-task=${cpus}`,
      "#SBATCH --mem=8G",
      "#SBATCH --time=00:30:00",
      "#SBATCH --output=logs/%x-%j.out",
      "#SBATCH --error=logs/%x-%j.err"
    ].join("\n")
  };
}

function gpuSmoke(partitions: PartitionSummary[], gpuPools: GpuPool[], jobs: QueueJob[]): BackfillRecipe | null {
  const pool = [...gpuPools].filter((item) => item.total > 0).sort((left, right) => right.usable - left.usable || left.type.localeCompare(right.type))[0];
  if (!pool) return null;
  const partition = partitions.find((item) => item.gpu_free > 0) ?? partitions[0];
  const pending = pendingGpu(jobs, pool.type);
  const status = pool.usable <= 0 ? "blocked" : pending > pool.usable ? "watch" : "ready";
  return {
    id: "gpu-smoke",
    title: "GPU smoke",
    status,
    signal: `${pool.usable}/${pool.total} ${pool.type} usable`,
    detail:
      status === "watch"
        ? `${pool.usable} ${pool.type} GPU(s) usable, but ${pending} pending GPU request(s) are visible; keep this to a validation run.`
        : `${pool.type} has enough visible supply for a short CUDA/import validation before a serious launch.`,
    snippet: [
      "#SBATCH --job-name=andromeda-gpu-smoke",
      `#SBATCH --partition=${partition?.name ?? "short"}`,
      "#SBATCH --nodes=1",
      "#SBATCH --ntasks=1",
      "#SBATCH --cpus-per-task=4",
      "#SBATCH --mem=16G",
      `#SBATCH --gres=gpu:${pool.type}:1`,
      "#SBATCH --time=00:45:00",
      "#SBATCH --output=logs/%x-%j.out",
      "#SBATCH --error=logs/%x-%j.err"
    ].join("\n")
  };
}

function gateAudit(jobs: QueueJob[]): BackfillRecipe | null {
  const gated = jobs.filter((job) => job.state === "PENDING" && isGated(job));
  if (!gated.length) return null;
  const gpu = gated.reduce((sum, job) => sum + job.gpu_count, 0);
  const ids = gated.slice(0, 12).map((job) => job.job_id).join(",");
  return {
    id: "gate-audit",
    title: "Gate audit",
    status: "ready",
    signal: `${gated.length} gated job${gated.length === 1 ? "" : "s"}`,
    detail: `${gated.length} gated job${gated.length === 1 ? " blocks" : "s block"} ${gpu} GPU before backfill can help.`,
    snippet: `squeue -j ${ids} --start; scontrol show job -dd ${ids} | sed -n "1,180p"`
  };
}

function storageGuard(storage: StorageResponse | null): BackfillRecipe | null {
  const critical = storage?.volumes.find((volume) => volume.severity === "critical");
  if (!critical) return null;
  return {
    id: "storage-guard",
    title: "Storage guard",
    status: "watch",
    signal: `${critical.name} ${critical.percent_used ?? "n/a"}%`,
    detail: `${critical.name} is critical; backfill wins can still fail if logs, environments, or checkpoints cannot write.`,
    snippet: `acct-chk "$USER"; du -sh ${critical.path ?? "$PWD"} 2>/dev/null | sort -h`
  };
}

function headlineFor(scheduler: SchedulerHealth | null, recipes: BackfillRecipe[]): string {
  if (!recipes.length) return "No backfill recipes can be built from the current snapshot.";
  const depth = scheduler?.backfill_last_depth;
  if (depth !== null && depth !== undefined) {
    return `Scheduler is checking ${depth} jobs per backfill cycle; small, dated recipes are the safest way to exploit gaps.`;
  }
  return "Use small, dated recipes when capacity exists but queue motion is hard to interpret.";
}

function pendingGpu(jobs: QueueJob[], type: string): number {
  return jobs
    .filter((job) => job.state === "PENDING")
    .reduce((sum, job) => sum + job.gpus.filter((gpu) => gpu.type === type).reduce((inner, gpu) => inner + gpu.count, 0), 0);
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}
