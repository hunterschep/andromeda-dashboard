import { Route } from "lucide-react";
import { buildExperimentRunway } from "../lib/experimentRunway";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ExperimentRunwayPanel({ jobs }: { jobs: QueueJob[] }) {
  const runway = buildExperimentRunway(jobs);
  return (
    <div className="runway-panel">
      <div className="runway-head">
        <SectionTitle icon={<Route size={18} />} title="Experiment Runway" />
        <span>{runway.label}</span>
      </div>
      {runway.jobs.length ? (
        <div className="runway-list">
          {runway.jobs.slice(0, 6).map((job) => (
            <article className={`runway-row tone-${job.tone}`} key={job.jobId}>
              <div className="runway-title">
                <div>
                  <strong>{job.name}</strong>
                  <span className="mono">{job.jobId} / {job.state} / {job.node}</span>
                </div>
                <em>{job.deadline}</em>
              </div>
              <div className="runway-track" aria-label={`${job.jobId} experiment runway`}>
                <span className="queued" style={{ width: job.state === "PENDING" ? "100%" : "18%" }} />
                <span className="running" style={{ width: `${Math.max(0, job.progress ?? 0)}%` }} />
              </div>
              <dl>
                <div>
                  <dt>wait</dt>
                  <dd>{job.wait}</dd>
                </div>
                <div>
                  <dt>elapsed</dt>
                  <dd>{job.elapsed}</dd>
                </div>
                <div>
                  <dt>remaining</dt>
                  <dd>{job.remaining}</dd>
                </div>
              </dl>
              <p>{job.headline}</p>
              <span>{job.action}</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No active jobs are visible for experiment runway tracking." />
      )}
    </div>
  );
}
