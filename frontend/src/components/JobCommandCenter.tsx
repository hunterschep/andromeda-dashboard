import { Copy, Radar } from "lucide-react";
import { buildJobMonitor } from "../lib/jobAdvisor";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function JobCommandCenter({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const monitor = buildJobMonitor(jobs, alias);
  if (!jobs.length) return <EmptyState text="No active experiments for the configured user." />;
  return (
    <div className="experiment-monitor">
      <div className="experiment-head">
        <SectionTitle icon={<Radar size={18} />} title="Experiment Monitor" />
        <dl>
          <div>
            <dt>running</dt>
            <dd>{monitor.running}</dd>
          </div>
          <div>
            <dt>pending</dt>
            <dd>{monitor.pending}</dd>
          </div>
          <div>
            <dt>GPU jobs</dt>
            <dd>{monitor.gpuJobs}</dd>
          </div>
          <div>
            <dt>checkpoint risk</dt>
            <dd>{monitor.checkpointRisk}</dd>
          </div>
        </dl>
      </div>
      <div className="experiment-list">
        {monitor.advisories.slice(0, 5).map((item) => (
          <article className={`experiment-row severity-${item.severity}`} key={item.jobId}>
            <div className="experiment-title">
              <div>
                <strong>{item.title}</strong>
                <span className="mono">{item.jobId}</span>
              </div>
              <button
                type="button"
                className="copy-button"
                onClick={() => onCopy(item.command, `job ${item.jobId}`)}
                title={item.commandLabel}
              >
                <Copy size={15} aria-hidden="true" />
              </button>
            </div>
            <p>{item.detail}</p>
            <dl>
              {item.facts.map((fact) => (
                <div key={`${item.jobId}-${fact.label}`}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
