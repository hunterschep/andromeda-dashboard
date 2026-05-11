import { Boxes, Copy } from "lucide-react";
import { buildGpuOccupancy } from "../lib/gpuOccupancy";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuOccupancyMatrix({
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
  const occupancy = buildGpuOccupancy(nodes, jobs, alias);
  if (!occupancy.rows.length) return <EmptyState text="No GPU occupancy is visible in this node snapshot." />;
  return (
    <section className="gpu-occupancy-panel" aria-label="GPU occupancy matrix">
      <div className="gpu-occupancy-head">
        <SectionTitle icon={<Boxes size={18} />} title="GPU Occupancy Matrix" />
        <span>{occupancy.label}</span>
      </div>
      <p>{occupancy.headline}</p>
      <div className="gpu-occupancy-list">
        {occupancy.rows.slice(0, 8).map((row) => (
          <article className={`gpu-occupancy-row tone-${row.tone}`} key={row.id}>
            <div className="gpu-occupancy-title">
              <div>
                <strong className="mono">{row.node}</strong>
                <span>{row.family}: {row.summary}</span>
              </div>
              <button type="button" className="icon-button" onClick={() => onCopy(row.command, `${row.node} GPU occupancy`)}>
                <Copy size={15} aria-hidden="true" />
                Probe
              </button>
            </div>
            <div className="gpu-occupancy-cells">
              {row.cells.map((cell) => (
                <span className={`state-${cell.state}`} key={cell.id} title={`${cell.label}: ${cell.detail}`}>
                  <b>{cell.label}</b>
                  <em>{cell.detail}</em>
                </span>
              ))}
            </div>
            <p>{row.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
