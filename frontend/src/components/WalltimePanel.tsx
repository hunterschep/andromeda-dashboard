import { Clock4 } from "lucide-react";
import { buildWalltimeSignals } from "../lib/walltime";
import type { PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function WalltimePanel({ jobs, partitions }: { jobs: QueueJob[]; partitions: PartitionSummary[] }) {
  const signals = buildWalltimeSignals(jobs, partitions);
  return (
    <section className="walltime-panel" aria-label="Walltime leverage">
      <div className="walltime-head">
        <SectionTitle icon={<Clock4 size={18} />} title="Walltime Leverage" />
        <span>{signals.filter((signal) => signal.severity !== "info").length} jobs to tune</span>
      </div>
      {signals.length ? (
        <div className="walltime-list">
          {signals.map((signal) => (
            <article key={signal.jobId} className={`walltime-row severity-${signal.severity}`}>
              <div className="walltime-title">
                <div>
                  <strong>{signal.jobName}</strong>
                  <span className="mono">{signal.jobId} / {signal.partition}</span>
                </div>
                <em>{signal.suggestion}</em>
              </div>
              <dl>
                <div>
                  <dt>current</dt>
                  <dd>{signal.current}</dd>
                </div>
                <div>
                  <dt>try</dt>
                  <dd>{signal.suggestion}</dd>
                </div>
              </dl>
              <p>{signal.reason}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="Walltime leverage appears when pending jobs are visible." />
      )}
    </section>
  );
}
