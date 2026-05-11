import { Copy, TerminalSquare } from "lucide-react";
import { buildJobRunbooks } from "../lib/jobRunbook";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function JobRunbookPanel({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const runbooks = buildJobRunbooks(jobs, alias);
  if (!runbooks.length) return <EmptyState text="No running or pending jobs need a runbook." />;
  return (
    <div className="job-runbook-panel">
      <div className="job-runbook-head">
        <SectionTitle icon={<TerminalSquare size={18} />} title="Experiment Runbook" />
        <span>{runbooks.length} jobs prepared</span>
      </div>
      <div className="job-runbook-list">
        {runbooks.map((runbook) => (
          <article key={runbook.jobId} className="job-runbook-row">
            <div className="job-runbook-title">
              <div>
                <strong className="mono">{runbook.jobId}</strong>
                <span>{runbook.name} / {runbook.state} / {runbook.node ?? "pending"}</span>
              </div>
            </div>
            <div className="job-runbook-actions">
              {runbook.commands.map((command) => (
                <button
                  type="button"
                  key={`${runbook.jobId}-${command.label}`}
                  className="runbook-command"
                  onClick={() => onCopy(command.command, `${runbook.jobId} ${command.label}`)}
                  title={command.detail}
                >
                  <Copy size={14} aria-hidden="true" />
                  <span>{command.label}</span>
                </button>
              ))}
            </div>
            <p>{runbook.commands[0]?.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
