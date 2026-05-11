import { Copy, Route } from "lucide-react";
import { buildJobLifecycleReplay } from "../lib/jobLifecycleReplay";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function JobLifecycleReplay({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const replay = buildJobLifecycleReplay(history?.jobs ?? [], alias);
  return (
    <div className="job-lifecycle-panel">
      <div className="job-lifecycle-head">
        <SectionTitle icon={<Route size={18} />} title="Job Lifecycle Replay" />
        <span>{replay.label}</span>
      </div>
      <p>{replay.summary}</p>
      {replay.rows.length ? (
        <div className="job-lifecycle-list">
          {replay.rows.map((row) => (
            <article className={`job-lifecycle-row tone-${row.tone}`} key={row.jobId}>
              <div className="job-lifecycle-title">
                <div>
                  <strong>{row.name}</strong>
                  <span className="mono">
                    {row.jobId} / {row.partition} / {row.requestedGpu ? `${row.requestedGpu} GPU` : "CPU"}
                  </span>
                </div>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => onCopy(row.command, `${row.jobId} lifecycle replay`)}
                  title={`Copy accounting replay probe for ${row.jobId}`}
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <div
                className="job-lifecycle-track"
                style={{ gridTemplateColumns: `${row.waitWeight}fr ${row.runWeight}fr 28px` }}
                aria-label={`${row.name} waited ${row.waitLabel}, ran ${row.runtimeLabel}, then ${row.state}`}
              >
                <span className="stage-wait" />
                <span className="stage-run" />
                <span className="stage-state" />
              </div>
              <dl className="job-lifecycle-times">
                <div>
                  <dt>wait</dt>
                  <dd>{row.waitLabel}</dd>
                </div>
                <div>
                  <dt>run</dt>
                  <dd>{row.runtimeLabel}</dd>
                </div>
                <div>
                  <dt>outcome</dt>
                  <dd>{row.state}</dd>
                </div>
              </dl>
              <p>{row.headline}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No accounting rows are available for lifecycle replay." />
      )}
    </div>
  );
}
