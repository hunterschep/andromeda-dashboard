import type { HistoryJob, HistoryResponse, QueueJob, StorageResponse, StorageVolume } from "../types";

export type DataStagingLevel = "ready" | "watch" | "blocked";

export type DataStagingSignal = {
  id: string;
  label: string;
  value: string;
  detail: string;
  severity: DataStagingLevel;
};

export type DataStagingPlan = {
  level: DataStagingLevel;
  label: string;
  headline: string;
  command: string;
  signals: DataStagingSignal[];
};

export function buildDataStagingPlan({
  storage,
  jobs,
  history,
  alias
}: {
  storage: StorageResponse | null;
  jobs: QueueJob[];
  history: HistoryResponse | null;
  alias: string;
}): DataStagingPlan {
  const volumes = storage?.volumes ?? [];
  const scratch = findVolume(volumes, "scratch") ?? volumes.slice().sort(bySeverity)[0];
  const home = findVolume(volumes, "home");
  const pending = jobs.filter((job) => job.state === "PENDING");
  const dated = pending.filter((job) => job.estimated_start_time);
  const footprint = recentFootprint(history?.jobs ?? []);
  const plannedGb = Math.max(100, footprint?.gb ?? 0);
  const scratchFree = freeGb(scratch);
  const level = planLevel(scratch, home, scratchFree, plannedGb);

  return {
    level,
    label: labelFor(level),
    headline: headlineFor(scratch, scratchFree, plannedGb, footprint),
    command: stagingCommand(alias),
    signals: [
      scratchSignal(scratch, scratchFree, plannedGb),
      footprintSignal(footprint, plannedGb),
      windowSignal(dated, pending),
      destinationSignal(home)
    ]
  };
}

function recentFootprint(jobs: HistoryJob[]): { job: HistoryJob; gb: number } | null {
  const footprints = jobs
    .map((job) => ({ job, gb: ioGb(job) }))
    .filter((item): item is { job: HistoryJob; gb: number } => item.gb !== null)
    .sort((left, right) => right.gb - left.gb);
  return footprints[0] ?? null;
}

function ioGb(job: HistoryJob): number | null {
  const pairs = Object.entries({ ...(job.tres_usage_in_ave ?? {}), ...(job.tres_usage_in_max ?? {}) });
  const bytes = pairs.filter(([key]) => /fs|disk|lustre|gpfs|read|write|io/i.test(key)).map(([, value]) => parseBytes(value));
  const observed = bytes.filter((value): value is number => value !== null);
  return observed.length ? Math.max(...observed) / 1024 ** 3 : null;
}

function parseBytes(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:I?B)?/i.exec(value);
  if (!match) return null;
  const factors: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5, E: 1024 ** 6 };
  return Number(match[1]) * factors[match[2].toUpperCase()];
}

function planLevel(
  scratch: StorageVolume | undefined,
  home: StorageVolume | undefined,
  scratchFree: number | null,
  plannedGb: number
): DataStagingLevel {
  if (!scratch) return "watch";
  if (scratch.severity === "critical" || (scratchFree !== null && scratchFree < plannedGb)) return "blocked";
  if (scratch.severity === "warning" || (scratchFree !== null && scratchFree < plannedGb * 2) || (home?.file_percent_used ?? 0) >= 85) return "watch";
  return "ready";
}

function headlineFor(
  scratch: StorageVolume | undefined,
  scratchFree: number | null,
  plannedGb: number,
  footprint: { job: HistoryJob; gb: number } | null
): string {
  if (!scratch) return "Quota data is unavailable; run a storage probe before staging large datasets.";
  if (scratchFree !== null && scratchFree < plannedGb) {
    return `${scratch.name} has ${formatGb(scratchFree)} free against a ${formatGb(plannedGb)} recent I/O footprint; clean or stage only a subset before the next run.`;
  }
  if (footprint) {
    return `${scratch.name} can cover the largest recent ${formatGb(plannedGb)} I/O footprint, but staging should still finish before Slurm releases the allocation.`;
  }
  return `${scratch.name} has enough visible headroom for a conservative 100 GB staging plan.`;
}

function scratchSignal(volume: StorageVolume | undefined, free: number | null, plannedGb: number): DataStagingSignal {
  if (!volume) {
    return { id: "scratch", label: "scratch runway", value: "unknown", detail: "Storage quota output is missing.", severity: "watch" };
  }
  const blocked = free !== null && free < plannedGb;
  return {
    id: "scratch",
    label: "scratch runway",
    value: free === null ? `${volume.percent_used ?? "n/a"}% used` : `${formatGb(free)} free`,
    detail: `${volume.name} is the preferred landing zone for datasets, checkpoints, and dataloader caches.`,
    severity: blocked || volume.severity === "critical" ? "blocked" : volume.severity === "warning" ? "watch" : "ready"
  };
}

function footprintSignal(footprint: { job: HistoryJob; gb: number } | null, plannedGb: number): DataStagingSignal {
  return {
    id: "footprint",
    label: "recent footprint",
    value: footprint ? `${formatGb(plannedGb)} recent` : "100 GB plan",
    detail: footprint
      ? `${footprint.job.name ?? footprint.job.job_id} is the heaviest recent filesystem record in accounting.`
      : "No filesystem counter was available, so the planner uses a conservative small-dataset baseline.",
    severity: footprint && plannedGb >= 1024 ? "watch" : "ready"
  };
}

function windowSignal(dated: QueueJob[], pending: QueueJob[]): DataStagingSignal {
  const first = dated[0];
  return {
    id: "window",
    label: "queue lead time",
    value: first ? `${dated.length} dated start${dated.length === 1 ? "" : "s"}` : `${pending.length} pending`,
    detail: first
      ? `${first.name ?? first.job_id} exposes a Slurm start estimate; finish staging before allocation release.`
      : "No visible pending job has a start estimate, so stage only after quota is confirmed.",
    severity: first ? "watch" : "ready"
  };
}

function destinationSignal(home: StorageVolume | undefined): DataStagingSignal {
  const files = home?.file_percent_used ?? null;
  return {
    id: "destination",
    label: "staging target",
    value: "/scratch/$USER",
    detail: files !== null && files >= 85 ? `Keep dataset copies out of home; file count is ${files}%.` : "Keep home for code and configs, not datasets.",
    severity: files !== null && files >= 85 ? "watch" : "ready"
  };
}

function findVolume(volumes: StorageVolume[], needle: string): StorageVolume | undefined {
  return volumes.find((volume) => `${volume.name} ${volume.path ?? ""}`.toLowerCase().includes(needle));
}

function bySeverity(left: StorageVolume, right: StorageVolume): number {
  return severityRank(right.severity) - severityRank(left.severity);
}

function severityRank(severity: StorageVolume["severity"]): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function freeGb(volume: StorageVolume | undefined): number | null {
  if (!volume || volume.used_gb === null || volume.quota_gb === null) return null;
  return Math.max(0, volume.quota_gb - volume.used_gb);
}

function labelFor(level: DataStagingLevel): string {
  if (level === "blocked") return "staging blocked";
  if (level === "watch") return "stage carefully";
  return "ready to stage";
}

function formatGb(value: number): string {
  if (value >= 1024) return `${(Math.round((value / 1024) * 10) / 10).toFixed(1)} TB`;
  if (value >= 100) return `${Math.round(value)} GB`;
  return `${Math.round(value * 10) / 10} GB`;
}

function stagingCommand(alias: string): string {
  return `rsync -avP ./data/ ${alias}:/scratch/$USER/project/data/ && ssh ${alias} 'du -sh /scratch/"$USER"/project/data 2>/dev/null; acct-chk "$USER"'`;
}
