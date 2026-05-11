import { Activity, Copy } from "lucide-react";
import type { CSSProperties } from "react";
import { buildQueueTrafficFlow } from "../lib/queueTrafficFlow";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function QueueTrafficFlowPanel({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const flow = buildQueueTrafficFlow(jobs, alias);
  if (!jobs.length) return <EmptyState text={flow.headline} />;

  return (
    <section className="queue-traffic-flow" aria-label="Queue traffic flow">
      <div className="queue-traffic-head">
        <SectionTitle icon={<Activity size={18} />} title="Queue Traffic Flow" />
        <div>
          <span>{flow.label}</span>
          <button
            type="button"
            className="copy-button"
            aria-label="Copy queue traffic probe"
            title="Copy queue traffic probe"
            onClick={() => onCopy(flow.command, "queue traffic")}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{flow.headline}</p>
      <div className="traffic-lanes" aria-label="Queue traffic lanes">
        {flow.lanes.map((lane) => (
          <article className={`traffic-lane tone-${lane.tone}`} key={lane.id}>
            <div>
              <strong>{lane.label}</strong>
              <span>{lane.count} job{lane.count === 1 ? "" : "s"}</span>
            </div>
            <i style={{ "--traffic-share": `${lane.share}%` } as CSSProperties} />
            <dl>
              <div>
                <dt>cpu</dt>
                <dd>{lane.cpus}</dd>
              </div>
              <div>
                <dt>gpu</dt>
                <dd>{lane.gpus}</dd>
              </div>
            </dl>
            <p>{lane.detail}</p>
          </article>
        ))}
      </div>
      <div className="traffic-tickets">
        {flow.tickets.map((ticket) => (
          <div className={`traffic-ticket lane-${ticket.lane}`} key={ticket.jobId}>
            <strong className="mono">{ticket.jobId}</strong>
            <span>{ticket.name}</span>
            <em>{ticket.request}</em>
            <b>{ticket.signal}</b>
          </div>
        ))}
      </div>
      <em className="traffic-action">{flow.action}</em>
    </section>
  );
}
