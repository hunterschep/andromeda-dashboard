import { Activity, Cpu, Database, Gauge, Server } from "lucide-react";

import {
  formatMemory,
  formatNumber,
} from "../api";
import type { CacheMeta, ClusterSummary, GpuPool, QueueJob, SchedulerHealth } from "../types";

type ExecutiveCommandProps = {
  cluster: ClusterSummary | undefined;
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  scheduler: SchedulerHealth | undefined;
  cache: CacheMeta[];
  loading: boolean;
  loadedAt: string | null;
};

type Tone = "calm" | "watch" | "hot" | "degraded";

function sumGpu(pools: GpuPool[], key: "total" | "usable" | "used" | "free"): number {
  return pools.reduce((total, pool) => total + (pool[key] ?? 0), 0);
}

function pendingGpuJobs(jobs: QueueJob[]): number {
  return jobs.reduce((total, job) => {
    if (job.state !== "PENDING") return total;
    return total + (job.gpu_count ?? 0);
  }, 0);
}

function toneFor(args: {
  staleSources: number;
  pendingGpu: number;
  usableGpu: number;
  pendingJobs: number;
  runningJobs: number;
  downNodes: number;
}): Tone {
  if (args.staleSources > 0) return "degraded";
  if (args.pendingGpu > Math.max(args.usableGpu, 0) && args.pendingGpu > 0) return "hot";
  if (args.pendingJobs > Math.max(args.runningJobs, 1) || args.downNodes > 0) return "watch";
  return "calm";
}

function stateCopy(tone: Tone, pendingGpu: number, usableGpu: number, staleSources: number): string {
  if (tone === "degraded") return `${staleSources} source${staleSources === 1 ? "" : "s"} need attention`;
  if (tone === "hot") return `${formatNumber(pendingGpu)} pending GPU ask / ${formatNumber(usableGpu)} usable`;
  if (tone === "watch") return "queue pressure is visible";
  return "capacity is readable";
}

function MetricCell({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="exec-metric">
      <span className="exec-metric-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export function ExecutiveCommand({
  cluster,
  gpuPools,
  jobs,
  scheduler,
  cache,
  loading,
  loadedAt,
}: ExecutiveCommandProps) {
  const runningJobs = cluster?.running_jobs ?? 0;
  const pendingJobs = cluster?.pending_jobs ?? 0;
  const availableNodes = cluster?.nodes_available ?? 0;
  const totalNodes = cluster?.nodes_total ?? 0;
  const downNodes = cluster?.nodes_down ?? Math.max(totalNodes - availableNodes, 0);
  const pooledTotalGpu = sumGpu(gpuPools, "total");
  const totalGpu = pooledTotalGpu || cluster?.gpu_total || 0;
  const usableGpu = (pooledTotalGpu ? sumGpu(gpuPools, "usable") : cluster?.gpu_free) ?? 0;
  const usedGpu = pooledTotalGpu ? sumGpu(gpuPools, "used") : Math.max(totalGpu - usableGpu, 0);
  const pendingGpu = pendingGpuJobs(jobs);
  const staleSources = cache.filter((item) => item.is_stale).length;
  const tone = toneFor({ staleSources, pendingGpu, usableGpu, pendingJobs, runningJobs, downNodes });
  const loadPct = totalGpu > 0 ? Math.round((usedGpu / totalGpu) * 100) : 0;
  const cellCount = 40;
  const activeCells = Math.round((Math.max(loadPct, pendingJobs > 0 ? 12 : 0) / 100) * cellCount);

  return (
    <section id="overview" className={`executive-command tone-${tone}`} aria-label="Cluster command surface">
      <div className="exec-status">
        <div>
          <span className="exec-kicker">Andromeda live</span>
          <h2>{tone === "hot" ? "GPU constrained" : tone === "degraded" ? "Data degraded" : tone === "watch" ? "Watch pressure" : "Operational"}</h2>
          <p>{stateCopy(tone, pendingGpu, usableGpu, staleSources)}</p>
        </div>
        <span className="exec-live">
          {loading ? "refreshing" : loadedAt ? "live" : "not loaded"}
        </span>
      </div>

      <dl className="exec-metric-grid">
        <MetricCell
          icon={<Activity size={16} />}
          label="Jobs"
          value={`${formatNumber(runningJobs)} / ${formatNumber(pendingJobs)}`}
          detail="running / pending"
        />
        <MetricCell
          icon={<Gauge size={16} />}
          label="GPUs"
          value={totalGpu > 0 ? `${formatNumber(usableGpu)} / ${formatNumber(totalGpu)}` : "n/a"}
          detail={totalGpu > 0 ? `${formatNumber(pendingGpu)} pending ask` : "n/a total"}
        />
        <MetricCell
          icon={<Server size={16} />}
          label="Nodes"
          value={`${formatNumber(availableNodes)} / ${formatNumber(totalNodes)}`}
          detail="available / total"
        />
        <MetricCell
          icon={<Cpu size={16} />}
          label="CPUs"
          value={cluster ? `${formatNumber(cluster.cpus_idle)} / ${formatNumber(cluster.cpus_total)}` : "n/a"}
          detail="idle / total"
        />
        <MetricCell
          icon={<Database size={16} />}
          label="Memory"
          value={cluster ? formatMemory(cluster.memory_free_mb) : "n/a"}
          detail="free"
        />
      </dl>

      <div className="exec-signal-row" aria-label="GPU load signal">
        <div>
          <span>GPU load</span>
          <strong>{totalGpu > 0 ? `${loadPct}%` : "n/a"}</strong>
        </div>
        <div className="exec-signal-cells" aria-hidden="true">
          {Array.from({ length: cellCount }, (_, index) => (
            <span key={index} className={index < activeCells ? "active" : ""} />
          ))}
        </div>
        <div>
          <span>Scheduler</span>
          <strong>{scheduler?.mean_cycle_seconds ? `${scheduler.mean_cycle_seconds.toFixed(1)}s` : "opaque"}</strong>
        </div>
      </div>
    </section>
  );
}
