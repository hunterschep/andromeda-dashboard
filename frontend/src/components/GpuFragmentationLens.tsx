import { Split } from "lucide-react";
import { buildGpuFragmentationLens } from "../lib/gpuFragmentation";
import type { GpuPool, NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuFragmentationLens({
  nodes,
  pools,
  jobs
}: {
  nodes: NodeResource[];
  pools: GpuPool[];
  jobs: QueueJob[];
}) {
  const lens = buildGpuFragmentationLens(nodes, pools, jobs);
  if (!lens.rows.length) return <EmptyState text={lens.headline} />;
  return (
    <section className="gpu-fragmentation-lens" aria-label="GPU fragmentation lens">
      <div className="gpu-fragmentation-head">
        <SectionTitle icon={<Split size={18} />} title="GPU Fragmentation Lens" />
        <span>{lens.label}</span>
      </div>
      <p>{lens.headline}</p>
      <div className="gpu-fragmentation-list">
        {lens.rows.slice(0, 6).map((row) => (
          <article className={`gpu-fragmentation-row tone-${row.tone}`} key={row.type}>
            <div className="gpu-fragmentation-title">
              <div>
                <strong className="mono">{row.type}</strong>
                <span>{row.pendingGpus} pending / {row.usable} usable</span>
              </div>
              <em>{row.largestNode} max</em>
            </div>
            <dl>
              <div>
                <dt>widest</dt>
                <dd>{row.widestPending}</dd>
              </div>
              <div>
                <dt>fit nodes</dt>
                <dd>{row.fitNodes}</dd>
              </div>
              <div>
                <dt>gated</dt>
                <dd>{row.gatedGpus}</dd>
              </div>
              <div>
                <dt>active nodes</dt>
                <dd>{row.activeNodes}</dd>
              </div>
            </dl>
            <div className="gpu-node-strip">
              {row.nodeFree.length ? row.nodeFree.map((node) => (
                <span key={`${row.type}-${node.name}`} style={{ flexGrow: Math.max(1, node.free) }}>
                  {node.name}: {node.free}
                </span>
              )) : <em>no usable nodes</em>}
            </div>
            <p>{row.signal}</p>
            <em>{row.action}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
