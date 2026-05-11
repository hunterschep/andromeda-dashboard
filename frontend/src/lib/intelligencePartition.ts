import type { HistoryResponse, PartitionSummary, QueueJob } from "../types";
import { score, toneForScore, waitBandForPressure } from "./intelligenceShared";
import type { PartitionIntel } from "./intelligenceTypes";

export function buildPartitionIntel(
  partitions: PartitionSummary[],
  jobs: QueueJob[],
  history: HistoryResponse | null
): PartitionIntel[] {
  const jobsByPartition = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    const partition = job.partition ?? "unassigned";
    jobsByPartition.set(partition, [...(jobsByPartition.get(partition) ?? []), job]);
  }

  return partitions
    .map((partition) => {
      const partitionJobs = jobsByPartition.get(partition.name) ?? [];
      const pending = partitionJobs.filter((job) => job.state === "PENDING");
      const running = partitionJobs.filter((job) => job.state === "RUNNING");
      const pendingCpu = pending.reduce((sum, job) => sum + job.cpus, 0);
      const pendingGpu = pending.reduce((sum, job) => sum + job.gpu_count, 0);
      const cpuPressure = partition.cpus_total ? 1 - partition.cpus_idle / partition.cpus_total : 0;
      const gpuPressure = partition.gpu_total ? 1 - partition.gpu_free / partition.gpu_total : 0;
      const demandPressure = pending.length / Math.max(partitionJobs.length, 1);
      const requestPressure = Math.max(
        pendingCpu / Math.max(partition.cpus_idle + pendingCpu, 1),
        pendingGpu / Math.max(partition.gpu_free + pendingGpu, 1)
      );
      const downPressure = partition.down_nodes / Math.max(partition.total_nodes, 1);
      const pressureScore = score(
        cpuPressure * 24 + gpuPressure * 30 + demandPressure * 20 + requestPressure * 18 + downPressure * 8
      );
      return {
        name: partition.name,
        running: running.length,
        pending: pending.length,
        pendingCpu,
        pendingGpu,
        freeGpu: partition.gpu_free,
        totalGpu: partition.gpu_total,
        idleCpu: partition.cpus_idle,
        totalCpu: partition.cpus_total,
        pressureScore,
        tone: toneForScore(pressureScore),
        constrainedBy: constrainedBy(partition, pending, pendingCpu, pendingGpu),
        waitBand: waitBandForPressure(pressureScore, history?.median_wait_seconds ?? null, pending.length),
        maxTime: partition.max_time
      };
    })
    .sort((left, right) => right.pressureScore - left.pressureScore || left.name.localeCompare(right.name));
}

function constrainedBy(
  partition: PartitionSummary,
  pendingJobs: QueueJob[],
  pendingCpu: number,
  pendingGpu: number
): string {
  const topReason = topReasonLabel(pendingJobs);
  if (!pendingJobs.length) return "headroom";
  if (partition.down_nodes > 0 && partition.down_nodes >= partition.idle_nodes) return "node health";
  if (pendingGpu > 0 && partition.gpu_total > 0 && partition.gpu_free === 0) return "GPU capacity";
  if (pendingGpu > partition.gpu_free && partition.gpu_total > 0) return "GPU fragmentation";
  if (pendingCpu > partition.cpus_idle) return "CPU slots";
  if (topReason) return topReason;
  return "scheduler priority";
}

function topReasonLabel(jobs: QueueJob[]): string | null {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const label = job.reason_label ?? job.state_reason;
    if (!label || label === "None") continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}
