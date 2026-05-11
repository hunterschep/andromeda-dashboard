import type { GpuPool, QueueJob } from "../types";
import { score, toneForScore } from "./intelligenceShared";
import type { GpuScarcity } from "./intelligenceTypes";

export function buildGpuScarcity(pools: GpuPool[], pendingJobs: QueueJob[]): GpuScarcity[] {
  const pendingByGpu = new Map<string, number>();
  for (const job of pendingJobs) {
    if (!job.gpus.length && job.gpu_count > 0) {
      pendingByGpu.set("generic", (pendingByGpu.get("generic") ?? 0) + job.gpu_count);
    }
    for (const gpu of job.gpus) {
      pendingByGpu.set(gpu.type, (pendingByGpu.get(gpu.type) ?? 0) + gpu.count);
    }
  }

  return pools
    .map((pool) => {
      const pending = pendingByGpu.get(pool.type) ?? pendingByGpu.get("generic") ?? 0;
      const usedPressure = pool.total ? pool.used / pool.total : 0;
      const demandPressure = pending / Math.max(pool.usable + pending, 1);
      const healthPressure = pool.nodes_total ? 1 - pool.nodes_available / pool.nodes_total : 0;
      const pressureScore = score(usedPressure * 52 + demandPressure * 34 + healthPressure * 14);
      return {
        type: pool.type,
        total: pool.total,
        used: pool.used,
        free: pool.free,
        usable: pool.usable,
        pending,
        nodesAvailable: pool.nodes_available,
        nodesTotal: pool.nodes_total,
        unhealthyNodes: pool.unhealthy_nodes,
        pressureScore,
        tone: toneForScore(pressureScore),
        label: scarcityLabel(pool, pending)
      };
    })
    .sort((left, right) => right.pressureScore - left.pressureScore || right.pending - left.pending || left.type.localeCompare(right.type));
}

function scarcityLabel(pool: GpuPool, pending: number): string {
  if (pool.usable === 0 && pending > 0) return "blocked";
  if (pending > pool.usable) return "contended";
  if (pool.usable <= Math.max(1, Math.ceil(pool.total * 0.15))) return "scarce";
  if (pool.nodes_available < pool.nodes_total) return "degraded";
  return "available";
}
