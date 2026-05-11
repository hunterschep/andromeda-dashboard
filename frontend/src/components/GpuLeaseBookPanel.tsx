import { Copy, KeyRound } from "lucide-react";
import { buildGpuLeaseBook } from "../lib/gpuLeaseBook";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuLeaseBookPanel({
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
  const book = buildGpuLeaseBook(nodes, jobs, alias);
  return (
    <section className="gpu-lease-book" aria-label="GPU lease book">
      <div className="gpu-lease-head">
        <SectionTitle icon={<KeyRound size={18} />} title="GPU Lease Book" />
        <span>{book.label}</span>
      </div>
      <p>{book.headline}</p>
      {book.rows.length ? (
        <div className="gpu-lease-list">
          {book.rows.slice(0, 6).map((row) => (
            <article className={`gpu-lease-row tone-${row.tone}`} key={row.id}>
              <div className="gpu-lease-title">
                <div>
                  <strong className="mono">{row.jobName}</strong>
                  <span>{row.user} / {row.jobId}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onCopy(row.command, `${row.jobId} GPU lease`)}>
                  <Copy size={15} aria-hidden="true" />
                  Probe
                </button>
              </div>
              <dl>
                <div>
                  <dt>lease</dt>
                  <dd>{row.type} / {row.count} GPU</dd>
                </div>
                <div>
                  <dt>release</dt>
                  <dd>{row.remaining}</dd>
                </div>
                <div>
                  <dt>family share</dt>
                  <dd>{row.heldPercent}%</dd>
                </div>
                <div>
                  <dt>behind</dt>
                  <dd>{row.queuedBehind} queued / {row.gatedBehind} gated</dd>
                </div>
                <div>
                  <dt>nodes</dt>
                  <dd>{row.nodes}</dd>
                </div>
              </dl>
              <p>{row.summary}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No running GPU leases are visible in this queue scope." />
      )}
    </section>
  );
}
