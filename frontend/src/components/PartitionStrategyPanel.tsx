import { Split } from "lucide-react";
import { buildPartitionStrategies } from "../lib/partitionStrategy";
import type { PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PartitionStrategyPanel({
  jobs,
  partitions
}: {
  jobs: QueueJob[];
  partitions: PartitionSummary[];
}) {
  const strategies = buildPartitionStrategies(jobs, partitions);
  return (
    <section className="partition-strategy-panel" aria-label="Partition strategy">
      <div className="partition-strategy-head">
        <SectionTitle icon={<Split size={18} />} title="Partition Strategy" />
        <span>{strategies.length} pending jobs analyzed</span>
      </div>
      {strategies.length ? (
        <div className="partition-strategy-list">
          {strategies.map((strategy) => (
            <article key={strategy.jobId} className={`partition-strategy-row status-${strategy.status}`}>
              <div className="partition-strategy-title">
                <div>
                  <strong className="mono">{strategy.jobId}</strong>
                  <span>{strategy.jobName}</span>
                </div>
                <em>{strategy.current} -&gt; {strategy.recommended}</em>
              </div>
              <dl>
                <div>
                  <dt>decision</dt>
                  <dd>{strategy.status}</dd>
                </div>
                <div>
                  <dt>confidence</dt>
                  <dd>{strategy.confidence}</dd>
                </div>
                <div>
                  <dt>request</dt>
                  <dd>{strategy.request}</dd>
                </div>
              </dl>
              <p>{strategy.message}</p>
              <span>{strategy.reason}</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending jobs are visible for partition strategy." />
      )}
    </section>
  );
}
