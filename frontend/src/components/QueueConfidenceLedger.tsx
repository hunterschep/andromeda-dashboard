import { Copy, SignalHigh } from "lucide-react";
import { buildQueueConfidence } from "../lib/queueConfidence";
import type { HistoryResponse, PriorityJob, QueueJob, QueuePredictionResponse, SchedulerHealth } from "../types";
import { SectionTitle } from "./common";

export function QueueConfidenceLedger({
  jobs,
  priorityJobs,
  scheduler,
  history,
  prediction,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  priorityJobs: PriorityJob[];
  scheduler: SchedulerHealth | null;
  history: HistoryResponse | null;
  prediction: QueuePredictionResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const confidence = buildQueueConfidence({ jobs, priorityJobs, scheduler, history, prediction, alias });
  return (
    <section className="queue-confidence-ledger" aria-label="Queue confidence ledger">
      <div className="queue-confidence-head">
        <SectionTitle icon={<SignalHigh size={18} />} title="Queue Confidence Ledger" />
        <div>
          <span>{confidence.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(confidence.command, "queue confidence")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{confidence.headline}</p>
      <div className="queue-confidence-score" aria-label={`Queue confidence ${confidence.score}%`}>
        <span style={{ width: `${confidence.score}%` }} />
      </div>
      <div className="queue-confidence-grid">
        {confidence.rows.map((row) => (
          <article className={`queue-confidence-row tone-${row.tone}`} key={row.id}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
            <p>{row.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
