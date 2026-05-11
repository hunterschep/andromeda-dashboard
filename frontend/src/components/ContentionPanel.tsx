import { Crosshair } from "lucide-react";
import { buildContentionMap, capacityText, demandText } from "../lib/contention";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ContentionPanel({
  partitions,
  nodes,
  jobs
}: {
  partitions: PartitionSummary[];
  nodes: NodeResource[];
  jobs: QueueJob[];
}) {
  const rows = buildContentionMap(partitions, nodes, jobs);
  if (!rows.length) return <EmptyState text="No partition capacity is available for contention analysis." />;
  return (
    <div className="contention-panel">
      <div className="contention-head">
        <SectionTitle icon={<Crosshair size={18} />} title="Bottleneck Map" />
        <span>{rows.filter((row) => row.pendingJobs).length} partitions under demand</span>
      </div>
      <div className="contention-grid">
        {rows.slice(0, 5).map((row) => (
          <article className={`contention-row severity-${row.severity}`} key={row.partition}>
            <div className="contention-title">
              <strong className="mono">{row.partition}</strong>
              <span>{row.bottleneck}</span>
              <em>{row.pressure}%</em>
            </div>
            <div className="contention-meter" aria-label={`${row.partition} pressure`}>
              <i style={{ width: `${Math.min(row.pressure, 100)}%` }} />
            </div>
            <dl>
              <div>
                <dt>pending</dt>
                <dd>{row.pendingJobs}</dd>
              </div>
              <div>
                <dt>demand</dt>
                <dd>{demandText(row)}</dd>
              </div>
              <div>
                <dt>free</dt>
                <dd>{capacityText(row)}</dd>
              </div>
            </dl>
            <p>{row.fragmentation ?? row.narrative}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
