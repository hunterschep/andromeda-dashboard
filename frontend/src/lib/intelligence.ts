import type {
  GpuPool,
  HistoryResponse,
  NodeResource,
  PartitionSummary,
  QueueJob,
  SchedulerHealth
} from "../types";
import { buildClusterIntelligence } from "./intelligenceCluster";
import { buildGpuScarcity } from "./intelligenceGpu";
import { buildPartitionIntel } from "./intelligencePartition";
import { buildQueueForecast } from "./intelligenceQueue";
import type { AndromedaIntelligence } from "./intelligenceTypes";

export type {
  AndromedaIntelligence,
  ClusterIntelligence,
  ForecastBand,
  GpuScarcity,
  IntelSignal,
  PartitionIntel,
  PressureTone,
  QueueExplanation,
  QueueForecast,
  TurnoverEvent
} from "./intelligenceTypes";

export function buildAndromedaIntelligence({
  nodes,
  gpuPools,
  partitions,
  jobs,
  history,
  scheduler
}: {
  nodes: NodeResource[];
  gpuPools: GpuPool[];
  partitions: PartitionSummary[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
  scheduler: SchedulerHealth | null;
}): AndromedaIntelligence {
  const pendingJobs = jobs.filter((job) => job.state === "PENDING");
  const gpuScarcity = buildGpuScarcity(gpuPools, pendingJobs);
  const partitionIntel = buildPartitionIntel(partitions, jobs, history);
  return {
    cluster: buildClusterIntelligence({ nodes, gpuPools, partitions, jobs, scheduler }),
    gpuScarcity,
    partitions: partitionIntel,
    queue: buildQueueForecast(pendingJobs, partitionIntel, gpuScarcity, history, scheduler)
  };
}
