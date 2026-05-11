import { Copy, GitBranch } from "lucide-react";
import { buildStartPathDecoder } from "../lib/startPathDecoder";
import type { NodeResource, PriorityJob, QueueJob, SchedulerHealth } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function StartPathDecoderPanel({
  jobs,
  nodes,
  priorityJobs,
  scheduler,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  priorityJobs: PriorityJob[];
  scheduler: SchedulerHealth | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const decoder = buildStartPathDecoder({ jobs, nodes, priorityJobs, scheduler, alias });
  return (
    <section className="start-path-panel" aria-label="Start path decoder">
      <div className="start-path-head">
        <SectionTitle icon={<GitBranch size={18} />} title="Start Path Decoder" />
        <span>{decoder.label}</span>
      </div>
      {decoder.rows.length ? (
        <>
          <p>{decoder.headline}</p>
          <div className="start-path-list">
            {decoder.rows.slice(0, 5).map((row) => (
              <article className={`start-path-row tone-${row.tone}`} key={row.jobId}>
                <div className="start-path-title">
                  <div>
                    <strong>{row.name}</strong>
                    <span className="mono">{row.jobId} / {row.partition}</span>
                  </div>
                  <button
                    type="button"
                    className="copy-button"
                    title="Copy start path probe"
                    aria-label="Copy start path probe"
                    onClick={() => onCopy(row.command, `${row.jobId} start path`)}
                  >
                    <Copy size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="start-path-stages">
                  {row.stages.map((stage) => (
                    <div className={`start-path-stage tone-${stage.tone}`} key={stage.key} title={stage.detail}>
                      <span>{stage.label}</span>
                      <strong>{stage.value}</strong>
                    </div>
                  ))}
                </div>
                <p>{row.summary}</p>
                <em>{row.action}</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={decoder.headline} />
      )}
    </section>
  );
}
