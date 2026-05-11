import { Waypoints } from "lucide-react";
import { buildQueueRunway } from "../lib/queueRunway";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function QueueRunwayPanel({ jobs }: { jobs: QueueJob[] }) {
  const lanes = buildQueueRunway(jobs);
  const estimated = lanes.reduce((total, lane) => total + lane.estimated, 0);
  const pending = lanes.reduce((total, lane) => total + lane.pending, 0);
  return (
    <div className="queue-runway-panel">
      <div className="queue-runway-head">
        <SectionTitle icon={<Waypoints size={18} />} title="Queue Runway" />
        <span>{estimated}/{pending} pending jobs sequenced</span>
      </div>
      {lanes.length ? (
        <div className="queue-runway-lanes">
          {lanes.slice(0, 6).map((lane) => (
            <article className={`queue-runway-lane tone-${lane.tone}`} key={lane.partition}>
              <div className="runway-lane-title">
                <strong className="mono">{lane.partition}</strong>
                <span>{lane.confidence} confidence</span>
              </div>
              <div className="runway-buckets">
                {lane.buckets.map((bucket) => (
                  <div key={`${lane.partition}-${bucket.label}`} className={bucket.count ? "active" : ""}>
                    <span>{bucket.label}</span>
                    <strong>{bucket.count}</strong>
                  </div>
                ))}
              </div>
              <dl>
                <div>
                  <dt>next</dt>
                  <dd>{lane.nextStart}</dd>
                </div>
                <div>
                  <dt>request</dt>
                  <dd>{lane.cpus} CPU / {lane.gpus} GPU</dd>
                </div>
                <div>
                  <dt>unknown</dt>
                  <dd>{lane.unknown}</dd>
                </div>
              </dl>
              <p>{lane.message}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending jobs are visible in the current filters." />
      )}
    </div>
  );
}
