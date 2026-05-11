import { Copy, Crosshair } from "lucide-react";
import { buildAcceleratorWindows } from "../lib/acceleratorWindows";
import type { GpuPool, NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function AcceleratorWindowPlanner({
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
  const planner = buildAcceleratorWindows(nodes, pools, jobs, alias);
  return (
    <section className="accelerator-window-planner" aria-label="Accelerator window planner">
      <div className="accelerator-window-head">
        <SectionTitle icon={<Crosshair size={18} />} title="Accelerator Window Planner" />
        <span>{planner.label}</span>
      </div>
      <p>{planner.headline}</p>
      {planner.rows.length ? (
        <div className="accelerator-window-grid">
          {planner.rows.slice(0, 5).map((row) => (
            <article className={`accelerator-window-row tone-${row.tone}`} key={row.type}>
              <div className="accelerator-window-title">
                <div>
                  <strong className="mono">{row.type}</strong>
                  <span>{row.window}</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(row.command, `${row.type} accelerator window`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>usable</dt>
                  <dd>{row.usable}</dd>
                </div>
                <div>
                  <dt>waiting</dt>
                  <dd>{row.waiting}</dd>
                </div>
                <div>
                  <dt>gated</dt>
                  <dd>{row.gated}</dd>
                </div>
                <div>
                  <dt>next return</dt>
                  <dd>{row.nextReturn}</dd>
                </div>
              </dl>
              <p>{row.summary}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No accelerator windows are visible in this snapshot." />
      )}
    </section>
  );
}
