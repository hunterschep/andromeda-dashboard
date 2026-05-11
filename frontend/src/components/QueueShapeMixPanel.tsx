import { Boxes } from "lucide-react";
import { buildQueueShapeMix } from "../lib/queueShapeMix";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function QueueShapeMixPanel({ jobs }: { jobs: QueueJob[] }) {
  const mix = buildQueueShapeMix(jobs);
  if (!mix.pending) return <EmptyState text={mix.headline} />;
  return (
    <section className="queue-shape-mix" aria-label="Queue shape mix">
      <div className="queue-shape-head">
        <SectionTitle icon={<Boxes size={18} />} title="Queue Shape Mix" />
        <span>{mix.label}</span>
      </div>
      <p>{mix.headline}</p>
      <dl className="queue-shape-summary">
        <div>
          <dt>pending</dt>
          <dd>{mix.pending}</dd>
        </div>
        <div>
          <dt>queued CPU</dt>
          <dd>{mix.totalCpus}</dd>
        </div>
        <div>
          <dt>queued GPU</dt>
          <dd>{mix.totalGpus}</dd>
        </div>
      </dl>
      <div className="queue-shape-list">
        {mix.buckets.map((bucket) => (
          <article className={`queue-shape-row tone-${bucket.tone}`} key={bucket.id}>
            <div className="queue-shape-title">
              <div>
                <strong>{bucket.label}</strong>
                <span>{bucket.jobs.join(", ")}</span>
              </div>
              <em>{bucket.share}%</em>
            </div>
            <div className="queue-shape-track" aria-hidden="true">
              <span style={{ width: `${Math.max(6, bucket.share)}%` }} />
            </div>
            <dl>
              <div>
                <dt>jobs</dt>
                <dd>{bucket.count}</dd>
              </div>
              <div>
                <dt>CPU</dt>
                <dd>{bucket.cpus}</dd>
              </div>
              <div>
                <dt>GPU</dt>
                <dd>{bucket.gpus}</dd>
              </div>
              <div>
                <dt>max time</dt>
                <dd>{bucket.maxWalltime}</dd>
              </div>
            </dl>
            <p>{bucket.signal}</p>
            <em>{bucket.action}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
