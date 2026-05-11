import { Copy, ShieldCheck } from "lucide-react";
import { buildCheckpointSentinel } from "../lib/checkpointSentinel";
import type { QueueJob } from "../types";
import { SectionTitle } from "./common";

export function CheckpointSentinelPanel({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const sentinel = buildCheckpointSentinel(jobs, alias);
  return (
    <div className="checkpoint-panel">
      <div className="checkpoint-head">
        <SectionTitle icon={<ShieldCheck size={18} />} title="Checkpoint Sentinel" />
        <span>{sentinel.label}</span>
      </div>
      <p>{sentinel.message}</p>
      {sentinel.jobs.length ? (
        <div className="checkpoint-list">
          {sentinel.jobs.slice(0, 5).map((job) => (
            <article className={`checkpoint-row tone-${job.tone}`} key={job.jobId}>
              <div className="checkpoint-title">
                <div>
                  <strong>{job.name}</strong>
                  <span className="mono">{job.jobId} / {job.node}</span>
                </div>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => onCopy(job.command, `${job.jobId} checkpoint`)}
                  title={`Copy checkpoint probe for ${job.jobId}`}
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="checkpoint-track" aria-label={`${job.jobId} walltime progress`}>
                <span style={{ width: `${job.progress ?? 0}%` }} />
              </div>
              <dl>
                <div>
                  <dt>remaining</dt>
                  <dd>{job.remaining}</dd>
                </div>
                <div>
                  <dt>progress</dt>
                  <dd>{job.progress === null ? "n/a" : `${job.progress}%`}</dd>
                </div>
                <div>
                  <dt>request</dt>
                  <dd>{job.request}</dd>
                </div>
              </dl>
              <p>{job.message}</p>
              <em>{job.action}</em>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
