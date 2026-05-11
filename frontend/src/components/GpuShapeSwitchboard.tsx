import { Copy, GitBranch } from "lucide-react";
import { buildGpuShapeSwitchboard } from "../lib/gpuShapeSwitchboard";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuShapeSwitchboard({
  nodes,
  jobs,
  onCopy
}: {
  nodes: NodeResource[];
  jobs: QueueJob[];
  onCopy: (text: string, label: string) => void;
}) {
  const switchboard = buildGpuShapeSwitchboard(jobs, nodes);
  return (
    <section className="gpu-shape-panel" aria-label="GPU shape switchboard">
      <div className="gpu-shape-head">
        <SectionTitle icon={<GitBranch size={18} />} title="GPU Shape Switchboard" />
        <span>{switchboard.label}</span>
      </div>
      <p>{switchboard.headline}</p>
      {switchboard.rows.length ? (
        <div className="gpu-shape-list">
          {switchboard.rows.slice(0, 5).map((row) => (
            <article className={`gpu-shape-row tone-${row.tone}`} key={row.jobId}>
              <div className="gpu-shape-title">
                <div>
                  <strong className="mono">{row.jobId}</strong>
                  <span>{row.name}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onCopy(row.patch, `${row.jobId} GPU shape`)}>
                  <Copy size={15} aria-hidden="true" />
                  Copy shape
                </button>
              </div>
              <strong>{row.title}</strong>
              <dl>
                <div>
                  <dt>request</dt>
                  <dd>{row.requested}x {row.type}</dd>
                </div>
                <div>
                  <dt>largest fit</dt>
                  <dd>{row.largestFit}</dd>
                </div>
                <div>
                  <dt>exact nodes</dt>
                  <dd>{row.exactFitNodes}</dd>
                </div>
                <div>
                  <dt>usable</dt>
                  <dd>{row.usable}</dd>
                </div>
              </dl>
              <code>{row.patch}</code>
              <p>{row.detail}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending GPU jobs are visible for shape switching." />
      )}
    </section>
  );
}
