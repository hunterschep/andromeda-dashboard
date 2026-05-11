import { Copy, TrendingUp } from "lucide-react";
import { buildQueueMotion } from "../lib/queueMotion";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function QueueMotionPanel({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const motion = buildQueueMotion(jobs, alias);
  if (!motion.pending) return <EmptyState text={motion.summary} />;
  return (
    <div className="queue-motion-panel">
      <div className="queue-motion-head">
        <SectionTitle icon={<TrendingUp size={18} />} title="Queue Motion" />
        <span>{motion.label}</span>
      </div>
      <p>{motion.summary}</p>
      <div className="queue-motion-list">
        {motion.items.slice(0, 5).map((item) => (
          <article className={`queue-motion-row tone-${item.tone}`} key={item.jobId}>
            <div className="queue-motion-title">
              <div>
                <strong>{item.title}</strong>
                <span className="mono">{item.jobId} / {item.name}</span>
              </div>
              <button
                type="button"
                className="copy-button"
                onClick={() => onCopy(item.command, `${item.jobId} queue motion`)}
                title={`Copy queue motion probe for ${item.jobId}`}
              >
                <Copy size={15} aria-hidden="true" />
              </button>
            </div>
            <dl>
              <div>
                <dt>age</dt>
                <dd>{item.age}</dd>
              </div>
              <div>
                <dt>eta</dt>
                <dd>{item.eta}</dd>
              </div>
              <div>
                <dt>request</dt>
                <dd>{item.request}</dd>
              </div>
            </dl>
            <p>{item.message}</p>
            <em>{item.action}</em>
          </article>
        ))}
      </div>
    </div>
  );
}
