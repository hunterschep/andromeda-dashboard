import { formatDuration } from "../api";
import type { QueueJob } from "../types";

export type QueueShapeTone = "gate" | "gpu" | "cpu" | "long" | "light";

export type QueueShapeBucket = {
  id: string;
  label: string;
  tone: QueueShapeTone;
  count: number;
  cpus: number;
  gpus: number;
  share: number;
  maxWalltime: string;
  jobs: string[];
  signal: string;
  action: string;
};

export type QueueShapeMix = {
  pending: number;
  totalCpus: number;
  totalGpus: number;
  label: string;
  headline: string;
  buckets: QueueShapeBucket[];
};

type ShapeDefinition = {
  id: string;
  label: string;
  tone: QueueShapeTone;
};

type ShapeAccumulator = ShapeDefinition & {
  count: number;
  cpus: number;
  gpus: number;
  maxWalltimeSeconds: number | null;
  jobs: string[];
};

export function buildQueueShapeMix(jobs: QueueJob[]): QueueShapeMix {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const groups = new Map<string, ShapeAccumulator>();
  for (const job of pending) {
    const shape = shapeFor(job);
    const current = groups.get(shape.id) ?? {
      ...shape,
      count: 0,
      cpus: 0,
      gpus: 0,
      maxWalltimeSeconds: null,
      jobs: []
    };
    current.count += 1;
    current.cpus += job.cpus;
    current.gpus += job.gpu_count;
    current.maxWalltimeSeconds = maxNullable(current.maxWalltimeSeconds, job.time_limit_seconds);
    current.jobs.push(job.name || job.job_id);
    groups.set(shape.id, current);
  }
  const buckets = Array.from(groups.values())
    .map((group) => bucketFor(group, pending.length))
    .sort(compareBuckets);
  return {
    pending: pending.length,
    totalCpus: pending.reduce((sum, job) => sum + job.cpus, 0),
    totalGpus: pending.reduce((sum, job) => sum + job.gpu_count, 0),
    label: pending.length ? `${buckets.length} pending shape${buckets.length === 1 ? "" : "s"}` : "clear",
    headline: headlineFor(buckets),
    buckets
  };
}

function shapeFor(job: QueueJob): ShapeDefinition {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  if (job.dependency || /depend|hold|begin/.test(reason)) {
    return { id: "dependency-gated", label: "Dependency-gated", tone: "gate" };
  }
  if (job.gpu_count >= 2) return { id: "wide-gpu", label: "Wide GPU", tone: "gpu" };
  if (job.gpu_count === 1) return { id: "single-gpu", label: "Single GPU", tone: "gpu" };
  if (job.cpus >= 32 || (job.memory_mb ?? 0) >= 131072) {
    return { id: "full-node-cpu", label: "Full-node CPU", tone: "cpu" };
  }
  if ((job.time_limit_seconds ?? 0) >= 24 * 3600) return { id: "long-cpu", label: "Long CPU", tone: "long" };
  return { id: "cpu-probe", label: "CPU probe", tone: "light" };
}

function bucketFor(group: ShapeAccumulator, pendingCount: number): QueueShapeBucket {
  const share = pendingCount ? Math.round((group.count / pendingCount) * 100) : 0;
  return {
    id: group.id,
    label: group.label,
    tone: group.tone,
    count: group.count,
    cpus: group.cpus,
    gpus: group.gpus,
    share,
    maxWalltime: group.maxWalltimeSeconds === null ? "implicit" : formatDuration(group.maxWalltimeSeconds),
    jobs: group.jobs.sort((left, right) => left.localeCompare(right)).slice(0, 3),
    signal: signalFor(group),
    action: actionFor(group.id)
  };
}

function signalFor(group: ShapeAccumulator): string {
  const names = group.jobs.slice(0, 2).join(", ");
  if (group.id === "dependency-gated") return `${names} cannot compete for resources until scheduler gates clear.`;
  if (group.id === "wide-gpu") return `${names} asks for ${group.gpus} GPU(s), so placement depends on contiguous accelerator turnover.`;
  if (group.id === "single-gpu") return `${names} is shaped for one accelerator and should be sensitive to backfill openings.`;
  if (group.id === "full-node-cpu") return `${names} gives the queue a wide CPU shape with ${group.cpus} queued core(s).`;
  if (group.id === "long-cpu") return `${names} is CPU-only, but long walltime can make backfill harder.`;
  return `${names} is a small CPU request that should move when normal backfill opens.`;
}

function actionFor(id: string): string {
  if (id === "dependency-gated") return "Clear scheduler gates before changing CPU, GPU, memory, or partition.";
  if (id === "wide-gpu") return "Check largest idle GPU fit before requesting wide accelerator shapes.";
  if (id === "single-gpu") return "Watch short partitions and backfill before reshaping.";
  if (id === "full-node-cpu") return "Reduce CPU or memory if the run can tolerate a smaller node shape.";
  if (id === "long-cpu") return "Shorten walltime or checkpoint to create more scheduler options.";
  return "Keep the request short; this is usually the easiest class to backfill.";
}

function headlineFor(buckets: QueueShapeBucket[]): string {
  if (!buckets.length) return "No pending request shape is visible in the current queue filters.";
  if (buckets.length === 1) return `${buckets[0].label} work defines the current pending queue.`;
  return `Queue is split across ${buckets[0].label.toLowerCase()} and ${buckets[1].label.toLowerCase()} work.`;
}

function compareBuckets(left: QueueShapeBucket, right: QueueShapeBucket): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.gpus - left.gpus || right.cpus - left.cpus || left.label.localeCompare(right.label);
}

function toneRank(tone: QueueShapeTone): number {
  return { light: 0, long: 1, cpu: 2, gpu: 3, gate: 4 }[tone];
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
