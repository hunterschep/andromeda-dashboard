import { Database } from "lucide-react";
import { formatMemory } from "../api";
import type { GpuScarcity } from "../lib/intelligence";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuTopologyPanel({
  nodes,
  jobs,
  scarcity
}: {
  nodes: NodeResource[];
  jobs: QueueJob[];
  scarcity: GpuScarcity[];
}) {
  const gpuNodes = nodes.filter((node) => node.gpu_total > 0);
  const jobsByNode = runningJobsByNode(jobs);
  if (!gpuNodes.length) return <EmptyState text="No GPU nodes are visible in the current node snapshot." />;

  return (
    <div className="gpu-topology-panel">
      <div className="gpu-topology-head">
        <SectionTitle icon={<Database size={18} />} title="GPU Topology" />
        <div className="gpu-topology-summary">
          {scarcity.slice(0, 4).map((pool) => (
            <span key={pool.type} className={`tone-${pool.tone}`}>
              {pool.type}: {pool.usable} usable
            </span>
          ))}
        </div>
      </div>
      <div className="gpu-node-grid">
        {gpuNodes.map((node) => (
          <GpuNodeTile key={node.name} node={node} jobs={jobsByNode.get(node.name) ?? []} />
        ))}
      </div>
    </div>
  );
}

function runningJobsByNode(jobs: QueueJob[]) {
  const jobsByNode = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    if (job.state !== "RUNNING") continue;
    for (const node of job.nodes) {
      jobsByNode.set(node, [...(jobsByNode.get(node) ?? []), job]);
    }
  }
  return jobsByNode;
}

function GpuNodeTile({ node, jobs }: { node: NodeResource; jobs: QueueJob[] }) {
  return (
    <article className={`gpu-node-tile ${node.is_available ? "available" : "unavailable"}`}>
      <div className="gpu-node-title">
        <strong className="mono">{node.name}</strong>
        <span>{node.state}</span>
      </div>
      <div className="gpu-node-chips">
        {node.gres.map((gpu) => (
          <div key={`${node.name}-${gpu.type}`} className="gpu-node-family">
            <span>{gpu.type}</span>
            <div className="gpu-node-cells">
              {Array.from({ length: Math.max(gpu.total, 1) }, (_item, index) => (
                <i key={index} className={index < gpu.used ? "used" : "free"} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <dl>
        <div>
          <dt>free</dt>
          <dd>{node.gpu_free} GPU</dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>{node.cpus_idle}/{node.cpus_total}</dd>
        </div>
        <div>
          <dt>memory</dt>
          <dd>{formatMemory(node.memory_free_mb)}</dd>
        </div>
      </dl>
      <div className="gpu-node-jobs">
        {jobs.length ? (
          jobs.slice(0, 3).map((job) => (
            <span key={job.job_id}>{job.user} / {job.name ?? job.job_id}</span>
          ))
        ) : (
          <span>no visible running jobs</span>
        )}
      </div>
    </article>
  );
}
