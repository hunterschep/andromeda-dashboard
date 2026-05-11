import { Copy, ShieldAlert } from "lucide-react";
import { buildPolicyConstraintDecoder } from "../lib/policyConstraintDecoder";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PolicyConstraintDecoderPanel({
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
  const decoder = buildPolicyConstraintDecoder({ jobs, nodes, partitions, alias });
  return (
    <section className="policy-constraint-panel" aria-label="Constraint and policy decoder">
      <div className="policy-constraint-head">
        <SectionTitle icon={<ShieldAlert size={18} />} title="Constraint & Policy Decoder" />
        <span>{decoder.label}</span>
      </div>
      {decoder.rows.length ? (
        <>
          <p>{decoder.headline}</p>
          <div className="policy-constraint-list">
            {decoder.rows.slice(0, 5).map((row) => (
              <article className={`policy-constraint-row tone-${row.tone}`} key={row.jobId}>
                <div className="policy-constraint-title">
                  <div>
                    <strong>{row.title}</strong>
                    <span className="mono">{row.jobId} / {row.name} / {row.partition}</span>
                  </div>
                  <button
                    type="button"
                    className="copy-button"
                    title="Copy policy and constraint probe"
                    aria-label="Copy policy and constraint probe"
                    onClick={() => onCopy(row.command, `${row.jobId} policy`)}
                  >
                    <Copy size={15} aria-hidden="true" />
                  </button>
                </div>
                <dl>
                  {row.signals.slice(0, 6).map((signal) => (
                    <div className={`tone-${signal.tone}`} key={`${row.jobId}-${signal.label}`}>
                      <dt>{signal.label}</dt>
                      <dd>{signal.value}</dd>
                    </div>
                  ))}
                </dl>
                <p>{row.detail}</p>
                <em>{row.action}</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={decoder.headline} />
      )}
    </section>
  );
}
