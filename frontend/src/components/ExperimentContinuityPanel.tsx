import { Copy, Layers3 } from "lucide-react";
import { buildExperimentContinuity } from "../lib/experimentContinuity";
import type { HistoryResponse, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ExperimentContinuityPanel({
  jobs,
  history,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const continuity = buildExperimentContinuity({ jobs, history, alias });
  if (!jobs.length) return <EmptyState text={continuity.headline} />;
  return (
    <section className="experiment-continuity-panel" aria-label="Experiment continuity">
      <div className="experiment-continuity-head">
        <SectionTitle icon={<Layers3 size={18} />} title="Experiment Continuity" />
        <div>
          <span>{continuity.label}</span>
          <button
            type="button"
            className="copy-button"
            title="Copy continuity probe"
            aria-label="Copy continuity probe"
            onClick={() => onCopy(continuity.command, "experiment continuity")}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{continuity.headline}</p>
      <div className="experiment-continuity-list">
        {continuity.rows.map((row) => (
          <article className={`experiment-continuity-row tone-${row.tone}`} key={row.jobId}>
            <div className="experiment-continuity-title">
              <div>
                <strong>{row.signal}</strong>
                <span className="mono">{row.jobId} / {row.name}</span>
              </div>
              <button
                type="button"
                className="copy-button"
                title="Copy experiment probe"
                aria-label="Copy experiment probe"
                onClick={() => onCopy(row.command, `${row.jobId} continuity`)}
              >
                <Copy size={15} aria-hidden="true" />
              </button>
            </div>
            <p>{row.detail}</p>
            <div className="experiment-continuity-evidence">
              {row.evidence.map((item) => <span key={`${row.jobId}-${item}`}>{item}</span>)}
            </div>
            <em>{row.action}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
