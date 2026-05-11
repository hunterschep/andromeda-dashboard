import { formatDuration } from "../api";
import type { GpuPool, QueueJob } from "../types";

export type ReleaseBucket = {
  label: string;
  count: number;
};

export type GpuReleaseRow = {
  type: string;
  usable: number;
  pending: number;
  running: number;
  releases: ReleaseBucket[];
  releasingSoon: number;
  nextRelease: string;
  nextJob: string | null;
  undated: number;
  tone: "calm" | "busy" | "hot";
  message: string;
};

const BUCKETS = [
  { label: "<30m", min: 0, max: 30 * 60 },
  { label: "30m-2h", min: 30 * 60, max: 2 * 3600 },
  { label: "2h-6h", min: 2 * 3600, max: 6 * 3600 },
  { label: "6h-24h", min: 6 * 3600, max: 24 * 3600 },
  { label: "24h+", min: 24 * 3600, max: Number.POSITIVE_INFINITY }
];

type FamilyAccumulator = {
  type: string;
  usable: number;
  pending: number;
  running: number;
  buckets: number[];
  nextSeconds: number | null;
  nextJob: string | null;
  undated: number;
};

export function buildGpuReleaseRadar(pools: GpuPool[], jobs: QueueJob[], nowMs = Date.now()): GpuReleaseRow[] {
  const families = new Map<string, FamilyAccumulator>();
  for (const pool of pools) families.set(pool.type, base(pool.type, pool.usable));

  for (const job of jobs) {
    if (job.gpu_count <= 0) continue;
    for (const request of gpuRequests(job)) {
      const family = ensure(families, request.type);
      if (job.state === "PENDING") family.pending += request.count;
      if (job.state === "RUNNING" || job.state === "COMPLETING") {
        family.running += request.count;
        addRelease(family, job, request.count, nowMs);
      }
    }
  }

  return Array.from(families.values())
    .map(toRow)
    .filter((row) => row.usable > 0 || row.pending > 0 || row.running > 0 || row.releasingSoon > 0 || row.undated > 0)
    .sort(compareRows);
}

function addRelease(family: FamilyAccumulator, job: QueueJob, count: number, nowMs: number) {
  const end = job.end_time ? new Date(job.end_time).getTime() : Number.NaN;
  if (!Number.isFinite(end) || end <= nowMs) {
    family.undated += count;
    return;
  }
  const seconds = Math.round((end - nowMs) / 1000);
  const bucket = BUCKETS.findIndex((item) => seconds >= item.min && seconds < item.max);
  family.buckets[Math.max(0, bucket)] += count;
  if (family.nextSeconds === null || seconds < family.nextSeconds) {
    family.nextSeconds = seconds;
    family.nextJob = job.job_id;
  }
}

function toRow(family: FamilyAccumulator): GpuReleaseRow {
  const releases = BUCKETS.map((bucket, index) => ({ label: bucket.label, count: family.buckets[index] ?? 0 }));
  const releasingSoon = releases.slice(0, 2).reduce((total, bucket) => total + bucket.count, 0);
  const tone = rowTone(family, releasingSoon);
  return {
    type: family.type,
    usable: family.usable,
    pending: family.pending,
    running: family.running,
    releases,
    releasingSoon,
    nextRelease: family.nextSeconds === null ? "no dated release" : formatDuration(family.nextSeconds),
    nextJob: family.nextJob,
    undated: family.undated,
    tone,
    message: message(family, releasingSoon)
  };
}

function message(family: FamilyAccumulator, releasingSoon: number): string {
  if (family.pending > family.usable + releasingSoon) {
    return `${family.pending} pending ${family.type} GPU request(s) exceed current usable capacity plus near-term turnover.`;
  }
  if (releasingSoon > 0) return `${releasingSoon} ${family.type} GPU(s) are expected back inside two hours.`;
  if (family.undated > 0) return `${family.undated} running ${family.type} GPU(s) do not expose future end times.`;
  if (family.usable > 0) return `${family.usable} ${family.type} GPU(s) are usable now with no visible pending demand.`;
  return `No near-term ${family.type} release is visible in this queue snapshot.`;
}

function rowTone(family: FamilyAccumulator, releasingSoon: number): GpuReleaseRow["tone"] {
  if (family.pending > family.usable + releasingSoon) return "hot";
  if (family.pending > family.usable || family.undated > family.running / 2) return "busy";
  return "calm";
}

function gpuRequests(job: QueueJob): { type: string; count: number }[] {
  if (job.gpus.length) return job.gpus.map((gpu) => ({ type: gpu.type, count: gpu.count }));
  return [{ type: "generic", count: job.gpu_count }];
}

function ensure(families: Map<string, FamilyAccumulator>, type: string): FamilyAccumulator {
  const existing = families.get(type);
  if (existing) return existing;
  const family = base(type, 0);
  families.set(type, family);
  return family;
}

function base(type: string, usable: number): FamilyAccumulator {
  return { type, usable, pending: 0, running: 0, buckets: BUCKETS.map(() => 0), nextSeconds: null, nextJob: null, undated: 0 };
}

function compareRows(left: GpuReleaseRow, right: GpuReleaseRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.pending - left.pending || right.releasingSoon - left.releasingSoon || left.type.localeCompare(right.type);
}

function toneRank(tone: GpuReleaseRow["tone"]): number {
  return { calm: 0, busy: 1, hot: 2 }[tone];
}
