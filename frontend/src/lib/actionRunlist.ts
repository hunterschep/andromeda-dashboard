import type { CacheMeta, GpuPool, QueueJob, QueuePredictionResponse, StorageResponse } from "../types";

export type ActionRunlistItem = {
  id: string;
  title: string;
  detail: string;
  tone: "critical" | "watch" | "info";
  command: string;
};

export type ActionRunlist = {
  label: string;
  headline: string;
  items: ActionRunlistItem[];
};

export function buildActionRunlist({
  jobs,
  myJobs,
  gpuPools,
  storage,
  cache,
  prediction,
  alias
}: {
  jobs: QueueJob[];
  myJobs: QueueJob[];
  gpuPools: GpuPool[];
  storage: StorageResponse | null;
  cache: CacheMeta[];
  prediction: QueuePredictionResponse | null;
  alias: string;
}): ActionRunlist {
  const items = [
    checkpointAction(myJobs, alias),
    storageAction(storage, alias),
    gpuPressureAction(jobs, gpuPools, alias),
    predictionAction(prediction),
    freshnessAction(cache, alias)
  ].filter((item): item is ActionRunlistItem => Boolean(item)).slice(0, 4);
  const critical = items.filter((item) => item.tone === "critical").length;
  const watch = items.filter((item) => item.tone === "watch").length;
  return {
    label: items.length ? `${critical} critical / ${watch} watch` : "clear",
    headline: headlineFor(items),
    items
  };
}

function checkpointAction(jobs: QueueJob[], alias: string): ActionRunlistItem | null {
  const urgent = jobs
    .filter((job) => job.state === "RUNNING" && job.time_limit_seconds && job.elapsed_seconds)
    .map((job) => ({ job, remaining: Math.max(0, (job.time_limit_seconds ?? 0) - (job.elapsed_seconds ?? 0)) }))
    .filter((row) => row.remaining <= 3600)
    .sort((left, right) => left.remaining - right.remaining)[0];
  if (!urgent) return null;
  return {
    id: "checkpoint",
    title: "Verify final checkpoint",
    detail: `${urgent.job.name ?? urgent.job.job_id} has ${minutes(urgent.remaining)} left; confirm output, stderr, and checkpoint target before walltime expires.`,
    tone: "critical",
    command: `ssh ${alias} 'sacct -j ${urgent.job.job_id} --format=JobID,State,Elapsed,Timelimit,NodeList -P; tail -n 80 logs/${urgent.job.job_id}.out 2>/dev/null || true'`
  };
}

function storageAction(storage: StorageResponse | null, alias: string): ActionRunlistItem | null {
  const volume = storage?.volumes.find((item) => item.severity === "critical");
  if (!volume) return null;
  return {
    id: "storage",
    title: `Clean ${volume.name} before launch`,
    detail: `${volume.name} is ${volume.percent_used ?? "n/a"}% used; staging, logs, or checkpoints can fail before Slurm explains it.`,
    tone: "critical",
    command: `ssh ${alias} 'acct-chk "$USER"; du -h --max-depth=1 ${volume.path ?? "/scratch/$USER"} 2>/dev/null | sort -h | tail -20'`
  };
}

function gpuPressureAction(jobs: QueueJob[], pools: GpuPool[], alias: string): ActionRunlistItem | null {
  const pendingGpu = jobs.filter((job) => job.state === "PENDING").reduce((sum, job) => sum + job.gpu_count, 0);
  const usableGpu = pools.reduce((sum, pool) => sum + pool.usable, 0);
  if (!pendingGpu || pendingGpu <= usableGpu) return null;
  return {
    id: "gpu",
    title: "Reduce GPU shape or wait",
    detail: `${pendingGpu} pending GPU are competing for ${usableGpu} usable GPU; split wide jobs or target a lower-pressure window.`,
    tone: "critical",
    command: `ssh ${alias} 'squeue -o "%i|%j|%P|%t|%M|%l|%C|%b|%R" -S -p,i | head -40'`
  };
}

function predictionAction(prediction: QueuePredictionResponse | null): ActionRunlistItem | null {
  const range = prediction?.wait_range_minutes;
  if (!prediction || !range || range.upper !== null || range.lower === null || range.lower < 60) return null;
  return {
    id: "prediction",
    title: "Treat queue range as open-ended",
    detail: `${prediction.wait_band} has a ${range.lower}m+ lower bound; make jobs smaller before waiting blindly.`,
    tone: "watch",
    command: "Adjust walltime, GPU count, or partition before resubmitting."
  };
}

function freshnessAction(cache: CacheMeta[], alias: string): ActionRunlistItem | null {
  const stale = cache.filter((meta) => meta.is_stale);
  if (!stale.length) return null;
  const noun = stale.length === 1 ? "source is" : "sources are";
  return {
    id: "freshness",
    title: "Refresh stale Slurm sources",
    detail: `${stale.length} ${noun} stale; treat affected panels as last-known state.`,
    tone: "watch",
    command: `ssh ${alias} 'sinfo --version; squeue -u "$USER" -h | head; sinfo -h | head'`
  };
}

function headlineFor(items: ActionRunlistItem[]): string {
  if (!items.length) return "No immediate action is visible from the current snapshot.";
  const first = items[0];
  if (items.length === 1) return `${first.title} is the only visible action from this snapshot.`;
  return `${first.title} is the first move; ${items.length - 1} other signal${items.length === 2 ? "" : "s"} follow.`;
}

function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}
