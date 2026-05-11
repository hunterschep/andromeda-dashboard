import { Copy, MessageSquareText } from "lucide-react";
import { buildQueueStoryline } from "../lib/queueStoryline";
import type { NodeResource, PartitionSummary, PriorityJob, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function QueueStorylinePanel({
  jobs,
  nodes,
  partitions,
  priorityJobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  priorityJobs: PriorityJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const storyline = buildQueueStoryline({ jobs, nodes, partitions, priorityJobs, alias });
  return (
    <section className="queue-storyline-panel" aria-label="Queue storyline">
      <div className="queue-storyline-head">
        <SectionTitle icon={<MessageSquareText size={18} />} title="Queue Storyline" />
        <span>{storyline.label}</span>
      </div>
      <p>{storyline.headline}</p>
      {storyline.stories.length ? (
        <div className="queue-storyline-list">
          {storyline.stories.map((story) => (
            <article className={`queue-storyline-row tone-${story.tone}`} key={story.jobId}>
              <div className="queue-storyline-title">
                <div>
                  <strong className="mono">{story.jobId}</strong>
                  <span>{story.title}</span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onCopy(story.command, `${story.jobId} storyline`)}
                >
                  <Copy size={15} aria-hidden="true" />
                  Probe
                </button>
              </div>
              <strong>{story.wait}</strong>
              <p>{story.reason}</p>
              <em>{story.next}</em>
              <div className="queue-storyline-evidence">
                {story.evidence.slice(0, 4).map((item) => <span key={`${story.jobId}-${item}`}>{item}</span>)}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending jobs need scheduler translation in the current filters." />
      )}
    </section>
  );
}
