import { Copy, Scissors } from "lucide-react";
import { buildRequestSurgery } from "../lib/requestSurgery";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function RequestSurgeryPanel({
  jobs,
  nodes,
  partitions,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const surgery = buildRequestSurgery(jobs, nodes, partitions, alias);
  return (
    <section className="request-surgery-panel" aria-label="Request surgery">
      <div className="request-surgery-head">
        <SectionTitle icon={<Scissors size={18} />} title="Request Surgery" />
        <span>{surgery.label}</span>
      </div>
      <p>{surgery.headline}</p>
      {surgery.items.length ? (
        <div className="request-surgery-list">
          {surgery.items.map((item) => (
            <article className={`request-surgery-row tone-${item.tone}`} key={item.jobId}>
              <div className="request-surgery-title">
                <div>
                  <strong className="mono">{item.jobId}</strong>
                  <span>{item.jobName}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onCopy(item.command, `${item.jobId} request surgery`)}>
                  <Copy size={15} aria-hidden="true" />
                  Copy patch
                </button>
              </div>
              <strong>{item.title}</strong>
              <code>{item.delta}</code>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending jobs are visible for request surgery." />
      )}
    </section>
  );
}
