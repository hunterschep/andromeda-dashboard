import { Route } from "lucide-react";
import { buildPartitionFitRadar } from "../lib/partitionFitRadar";
import type { PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PartitionFitRadarPanel({
  partitions,
  jobs
}: {
  partitions: PartitionSummary[];
  jobs: QueueJob[];
}) {
  const radar = buildPartitionFitRadar(partitions, jobs);
  if (!radar.rows.length) return <EmptyState text={radar.headline} />;
  return (
    <section className="partition-fit-radar" aria-label="Partition fit radar">
      <div className="partition-fit-head">
        <SectionTitle icon={<Route size={18} />} title="Partition Fit Radar" />
        <span>{radar.label}</span>
      </div>
      <p>{radar.headline}</p>
      <div className="partition-fit-list">
        {radar.rows.slice(0, 6).map((row) => (
          <article className={`partition-fit-row tone-${row.tone}`} key={row.name}>
            <div className="partition-fit-title">
              <div>
                <strong className="mono">{row.name}</strong>
                <span>{row.role}</span>
              </div>
              <em>{row.pressure}</em>
            </div>
            <dl>
              <div>
                <dt>pending</dt>
                <dd>{row.pending}</dd>
              </div>
              <div>
                <dt>running</dt>
                <dd>{row.running}</dd>
              </div>
              <div>
                <dt>idle CPU</dt>
                <dd>{row.idleCpu}</dd>
              </div>
              <div>
                <dt>free GPU</dt>
                <dd>{row.freeGpu}</dd>
              </div>
              <div>
                <dt>max time</dt>
                <dd>{row.maxTime}</dd>
              </div>
            </dl>
            <p>{row.signal}</p>
            <em>{row.action}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
