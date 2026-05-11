import { Copy, Map } from "lucide-react";
import { buildNodeNeighborhoodMap } from "../lib/nodeNeighborhoods";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function NodeNeighborhoodMap({
  nodes,
  jobs,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const map = buildNodeNeighborhoodMap(nodes, jobs, alias);
  if (!nodes.length) return <EmptyState text={map.headline} />;
  return (
    <section className="node-neighborhood-panel" aria-label="Node neighborhood map">
      <div className="node-neighborhood-head">
        <SectionTitle icon={<Map size={18} />} title="Node Neighborhood Map" />
        <span>{map.label}</span>
      </div>
      <p>{map.headline}</p>
      <div className="node-neighborhood-list">
        {map.rows.slice(0, 6).map((row) => (
          <article className={`node-neighborhood-row tone-${row.tone}`} key={row.id}>
            <div className="node-neighborhood-title">
              <div>
                <strong className="mono">{row.label}</strong>
                <span>{row.range}</span>
              </div>
              <button type="button" className="copy-button" onClick={() => onCopy(row.command, `${row.label} neighborhood`)}>
                <Copy size={15} aria-hidden="true" />
              </button>
            </div>
            <dl>
              <div>
                <dt>nodes</dt>
                <dd>{row.available}/{row.nodes}</dd>
              </div>
              <div>
                <dt>GPU</dt>
                <dd>{row.freeGpu}/{row.totalGpu}</dd>
              </div>
              <div>
                <dt>blocked</dt>
                <dd>{row.blockedGpu}</dd>
              </div>
              <div>
                <dt>pending</dt>
                <dd>{row.pendingGpu}</dd>
              </div>
            </dl>
            <div className="node-neighborhood-strip">
              <span>{row.partitions.slice(0, 4).join(", ") || "unassigned"}</span>
              <em>{row.gpuTypes.slice(0, 4).join(", ") || "CPU only"}</em>
            </div>
            <p>{row.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
