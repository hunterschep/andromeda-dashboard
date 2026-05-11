import { formatDuration } from "../api";
import type { QueueJob } from "../types";

export type RunwayBucket = {
  label: string;
  count: number;
};

export type QueueRunwayLane = {
  partition: string;
  pending: number;
  estimated: number;
  unknown: number;
  cpus: number;
  gpus: number;
  buckets: RunwayBucket[];
  nextStart: string;
  confidence: "low" | "medium" | "high";
  tone: "calm" | "busy" | "hot";
  message: string;
};

const BUCKETS = [
  { label: "due", max: 0 },
  { label: "<30m", max: 30 * 60 },
  { label: "30m-2h", max: 2 * 3600 },
  { label: "2h-6h", max: 6 * 3600 },
  { label: "6h+", max: Number.POSITIVE_INFINITY },
  { label: "unknown", max: Number.POSITIVE_INFINITY }
];

export function buildQueueRunway(jobs: QueueJob[], nowMs = Date.now()): QueueRunwayLane[] {
  const groups = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    if (job.state !== "PENDING") continue;
    const partition = job.partition ?? "unknown";
    groups.set(partition, [...(groups.get(partition) ?? []), job]);
  }
  return Array.from(groups.entries()).map(([partition, rows]) => lane(partition, rows, nowMs)).sort(compareLanes);
}

function lane(partition: string, jobs: QueueJob[], nowMs: number): QueueRunwayLane {
  const buckets = BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
  let nextSeconds: number | null = null;
  for (const job of jobs) {
    const seconds = secondsUntil(job.estimated_start_time, nowMs);
    if (seconds === null) {
      buckets[5].count += 1;
      continue;
    }
    if (nextSeconds === null || seconds < nextSeconds) nextSeconds = seconds;
    buckets[bucketIndex(seconds)].count += 1;
  }
  const estimated = jobs.length - buckets[5].count;
  const unknown = buckets[5].count;
  const gpus = jobs.reduce((total, job) => total + job.gpu_count, 0);
  const cpus = jobs.reduce((total, job) => total + job.cpus, 0);
  const confidence = confidenceFor(estimated, jobs.length);
  const tone = toneFor(unknown, jobs.length, gpus);
  return {
    partition,
    pending: jobs.length,
    estimated,
    unknown,
    cpus,
    gpus,
    buckets,
    nextStart: nextSeconds === null ? "no estimate" : formatDuration(nextSeconds),
    confidence,
    tone,
    message: message(partition, jobs.length, estimated, unknown, gpus, nextSeconds)
  };
}

function message(partition: string, pending: number, estimated: number, unknown: number, gpus: number, nextSeconds: number | null): string {
  if (unknown > estimated) return `${partition} has ${unknown}/${pending} pending jobs without start estimates; scheduler confidence is limited.`;
  if (gpus > 0 && nextSeconds !== null) return `${gpus} GPU requested; next visible start is ${formatDuration(nextSeconds)}.`;
  if (nextSeconds !== null) return `${estimated}/${pending} pending jobs have dated starts; next runway slot is ${formatDuration(nextSeconds)}.`;
  return `${partition} has pending work, but Slurm did not expose dated starts for this snapshot.`;
}

function bucketIndex(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < BUCKETS[1].max) return 1;
  if (seconds < BUCKETS[2].max) return 2;
  if (seconds < BUCKETS[3].max) return 3;
  return 4;
}

function secondsUntil(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((time - nowMs) / 1000));
}

function confidenceFor(estimated: number, total: number): QueueRunwayLane["confidence"] {
  if (!total) return "low";
  const ratio = estimated / total;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.35) return "medium";
  return "low";
}

function toneFor(unknown: number, total: number, gpus: number): QueueRunwayLane["tone"] {
  if (total > 0 && unknown / total > 0.6) return "hot";
  if (gpus > 0 || unknown > 0) return "busy";
  return "calm";
}

function compareLanes(left: QueueRunwayLane, right: QueueRunwayLane): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.gpus - left.gpus || right.pending - left.pending || left.partition.localeCompare(right.partition);
}

function toneRank(tone: QueueRunwayLane["tone"]): number {
  return { calm: 0, busy: 1, hot: 2 }[tone];
}
