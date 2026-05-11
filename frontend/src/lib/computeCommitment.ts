import type { QueueJob } from "../types";

export type CommitmentLane = {
  partition: string;
  running: number;
  pending: number;
  gpuHours: number;
  cpuHours: number;
  undated: number;
  tone: "calm" | "busy" | "hot";
};

export type ComputeCommitment = {
  runningGpuHours: number;
  runningCpuHours: number;
  pendingGpuHours: number;
  pendingCpuHours: number;
  undatedJobs: number;
  headline: string;
  lanes: CommitmentLane[];
};

export function buildComputeCommitment(jobs: QueueJob[]): ComputeCommitment {
  const lanes = new Map<string, CommitmentLane>();
  let runningGpuHours = 0;
  let runningCpuHours = 0;
  let pendingGpuHours = 0;
  let pendingCpuHours = 0;
  let undatedJobs = 0;

  for (const job of jobs) {
    if (job.state !== "RUNNING" && job.state !== "PENDING") continue;
    const hours = committedHours(job);
    if (hours === null) undatedJobs += 1;
    const gpuHours = job.gpu_count * (hours ?? 0);
    const cpuHours = job.cpus * (hours ?? 0);
    if (job.state === "RUNNING") {
      runningGpuHours += gpuHours;
      runningCpuHours += cpuHours;
    } else {
      pendingGpuHours += gpuHours;
      pendingCpuHours += cpuHours;
    }
    updateLane(lanes, job, gpuHours, cpuHours, hours === null);
  }

  const sortedLanes = Array.from(lanes.values()).map(finalizeLane).sort(compareLanes);
  return {
    runningGpuHours,
    runningCpuHours,
    pendingGpuHours,
    pendingCpuHours,
    undatedJobs,
    headline: headline(runningGpuHours, pendingGpuHours, undatedJobs),
    lanes: sortedLanes
  };
}

function updateLane(lanes: Map<string, CommitmentLane>, job: QueueJob, gpuHours: number, cpuHours: number, undated: boolean) {
  const partition = job.partition ?? "unknown";
  const lane = lanes.get(partition) ?? {
    partition,
    running: 0,
    pending: 0,
    gpuHours: 0,
    cpuHours: 0,
    undated: 0,
    tone: "calm" as const
  };
  lane.running += job.state === "RUNNING" ? 1 : 0;
  lane.pending += job.state === "PENDING" ? 1 : 0;
  lane.gpuHours += gpuHours;
  lane.cpuHours += cpuHours;
  lane.undated += undated ? 1 : 0;
  lanes.set(partition, lane);
}

function finalizeLane(lane: CommitmentLane): CommitmentLane {
  const load = lane.gpuHours * 8 + lane.cpuHours / 64 + lane.pending * 2 + lane.undated * 6;
  return {
    ...lane,
    tone: load >= 80 || lane.undated > lane.running + lane.pending / 2 ? "hot" : load >= 20 || lane.pending > 0 ? "busy" : "calm"
  };
}

function committedHours(job: QueueJob): number | null {
  if (!job.time_limit_seconds) return null;
  if (job.state === "RUNNING") {
    return Math.max(0, (job.time_limit_seconds - (job.elapsed_seconds ?? 0)) / 3600);
  }
  return job.time_limit_seconds / 3600;
}

function headline(runningGpuHours: number, pendingGpuHours: number, undatedJobs: number): string {
  if (undatedJobs > 0) return `${undatedJobs} active request(s) are missing walltime, weakening turnover forecasts.`;
  if (runningGpuHours + pendingGpuHours >= 100) return "GPU walltime commitment is heavy across the visible queue.";
  if (runningGpuHours > 0) return "Visible jobs are actively reserving GPU walltime.";
  return "Visible compute commitment is mostly CPU or waiting for dated work.";
}

function compareLanes(left: CommitmentLane, right: CommitmentLane): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.gpuHours - left.gpuHours || right.cpuHours - left.cpuHours || left.partition.localeCompare(right.partition);
}

function toneRank(tone: CommitmentLane["tone"]): number {
  return { calm: 0, busy: 1, hot: 2 }[tone];
}

export function hours(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString();
  return value.toFixed(value >= 10 ? 1 : 2);
}
