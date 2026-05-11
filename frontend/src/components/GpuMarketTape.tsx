import { Copy, TrendingUp } from "lucide-react";
import { buildGpuMarketTape } from "../lib/gpuMarketTape";
import type { GpuPool, NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuMarketTape({
  nodes,
  pools,
  jobs,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  pools: GpuPool[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const tape = buildGpuMarketTape(nodes, pools, jobs, alias);
  return (
    <section className="gpu-market-panel" aria-label="GPU market tape">
      <div className="gpu-market-head">
        <SectionTitle icon={<TrendingUp size={18} />} title="GPU Market Tape" />
        <span>{tape.label}</span>
      </div>
      <p>{tape.headline}</p>
      {tape.rows.length ? (
        <div className="gpu-market-list">
          {tape.rows.slice(0, 5).map((row) => (
            <article className={`gpu-market-row tone-${row.tone}`} key={row.type}>
              <div className="gpu-market-title">
                <div>
                  <strong className="mono">{row.type}</strong>
                  <span>{row.status}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onCopy(row.command, `${row.type} GPU scarcity`)}>
                  <Copy size={15} aria-hidden="true" />
                  Probe
                </button>
              </div>
              <div className="gpu-market-meter">
                <span style={{ width: `${Math.min(100, row.pressure)}%` }} />
              </div>
              <dl>
                <div>
                  <dt>pressure</dt>
                  <dd>{row.pressure}%</dd>
                </div>
                <div>
                  <dt>waiting</dt>
                  <dd>{row.pending}</dd>
                </div>
                <div>
                  <dt>usable</dt>
                  <dd>{row.usable}</dd>
                </div>
                <div>
                  <dt>blocked</dt>
                  <dd>{row.blocked}</dd>
                </div>
                <div>
                  <dt>return &lt;2h</dt>
                  <dd>{row.returningSoon}</dd>
                </div>
              </dl>
              <p>{row.summary}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No GPU market tape can be built from this snapshot." />
      )}
    </section>
  );
}
