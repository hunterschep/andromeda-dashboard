import { Copy } from "lucide-react";
import { formatDuration, shortTime } from "../api";
import { jobSortScore } from "../lib/dashboard";
import type { HistoryResponse, QueueJob } from "../types";
import { EmptyState } from "./common";

export function JobRuntimePanel({ jobs }: { jobs: QueueJob[] }) {
  const visible = jobs
    .slice()
    .sort((left, right) => jobSortScore(right) - jobSortScore(left))
    .slice(0, 10);
  if (!visible.length) return null;
  return (
    <div className="runtime-panel">
      {visible.map((job) => {
        const progress =
          job.elapsed_seconds && job.time_limit_seconds
            ? Math.min(100, Math.round((job.elapsed_seconds / job.time_limit_seconds) * 100))
            : null;
        return (
          <div className="runtime-row" key={job.job_id}>
            <strong className="mono">{job.job_id}</strong>
            <span>{job.state}</span>
            <span>{job.partition ?? "n/a"}</span>
            <span>{formatDuration(job.elapsed_seconds)}</span>
            <span>{job.gpu_count} GPU</span>
            <div className="runtime-track" aria-label={`${job.job_id} runtime`}>
              <i style={{ width: `${progress ?? 0}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function JobList({
  jobs,
  onCopy,
  alias
}: {
  jobs: QueueJob[];
  onCopy: (text: string, label: string) => void;
  alias: string;
}) {
  if (!jobs.length) return <EmptyState text="No visible jobs for the configured user." />;
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <article key={job.job_id} className="job-item">
          <div className="job-heading">
            <div>
              <strong>
                {job.job_id} {job.name ? `- ${job.name}` : ""}
              </strong>
              <span>
                {job.state} on {job.partition ?? "n/a"}
              </span>
            </div>
            <button
              type="button"
              className="copy-button"
              onClick={() =>
                onCopy(`ssh ${alias} 'scontrol show job -dd ${job.job_id}'`, `job ${job.job_id}`)
              }
              title="Copy job detail command"
            >
              <Copy size={15} aria-hidden="true" />
            </button>
          </div>
          <dl>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatDuration(job.elapsed_seconds)}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{formatDuration(job.time_limit_seconds)}</dd>
            </div>
            <div>
              <dt>Request</dt>
              <dd>
                {job.cpus} CPU / {job.gpu_count} GPU
              </dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{job.nodes.join(", ") || "pending"}</dd>
            </div>
          </dl>
          {job.dependency ? <p>Dependency: {job.dependency}</p> : null}
          {job.state_reason ? <p>{job.reason_label ?? job.state_reason}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function HistoryBox({ history }: { history: HistoryResponse | null }) {
  return (
    <div className="history-box">
      <dl>
        <div>
          <dt>Window</dt>
          <dd>{history?.days ?? 7} days</dd>
        </div>
        <div>
          <dt>Jobs</dt>
          <dd>{history?.jobs.length ?? 0}</dd>
        </div>
        <div>
          <dt>Median wait</dt>
          <dd>{formatDuration(history?.median_wait_seconds)}</dd>
        </div>
        <div>
          <dt>Median runtime</dt>
          <dd>{formatDuration(history?.median_runtime_seconds)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function HistoryTable({ history }: { history: HistoryResponse | null }) {
  const jobs = history?.jobs.slice(0, 12) ?? [];
  if (!jobs.length) return <EmptyState text="No accounting rows in this window." />;
  return (
    <div className="table-wrap history-table">
      <table className="compact-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>State</th>
            <th>Partition</th>
            <th>Wait</th>
            <th>Runtime</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_id}>
              <td className="mono">{job.job_id}</td>
              <td>{job.state}</td>
              <td>{job.partition ?? "n/a"}</td>
              <td>{formatDuration(job.wait_seconds)}</td>
              <td>{formatDuration(job.runtime_seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
