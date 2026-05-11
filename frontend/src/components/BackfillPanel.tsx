import { Radar } from "lucide-react";
import { buildBackfillOpportunities } from "../lib/backfill";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function BackfillPanel({
  nodes,
  partitions,
  jobs
}: {
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  jobs: QueueJob[];
}) {
  const opportunities = buildBackfillOpportunities(nodes, partitions, jobs);
  return (
    <section className="backfill-panel" aria-label="Backfill opportunities">
      <div className="backfill-head">
        <SectionTitle icon={<Radar size={18} />} title="Backfill Radar" />
        <span>{opportunities.filter((item) => item.fitNodes > 0).length} shapes fit now</span>
      </div>
      {opportunities.length ? (
        <div className="backfill-list">
          {opportunities.map((item) => (
            <article key={item.label} className={`backfill-row severity-${item.severity}`}>
              <div className="backfill-title">
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.request}</span>
                </div>
                <em>{item.fitNodes ? `${item.fitNodes} fit` : "blocked"}</em>
              </div>
              <dl>
                <div>
                  <dt>partition</dt>
                  <dd>{item.partition}</dd>
                </div>
                <div>
                  <dt>best node</dt>
                  <dd>{item.bestNode}</dd>
                </div>
                <div>
                  <dt>largest GPU</dt>
                  <dd>{item.largestGpu}</dd>
                </div>
              </dl>
              <p>{item.advice}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="Backfill radar needs partition and node inventory." />
      )}
    </section>
  );
}
