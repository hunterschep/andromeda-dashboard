import { ClipboardList, Copy, TriangleAlert } from "lucide-react";
import { buildFailureDiagnostics, failureCommands } from "../lib/failureDiagnostics";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function FailureDiagnosticsPanel({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const { summary, diagnostics } = buildFailureDiagnostics(history?.jobs ?? []);
  return (
    <div className="failure-panel">
      <div className="failure-head">
        <SectionTitle icon={<TriangleAlert size={18} />} title="Failure Diagnostics" />
        <span>{summary.cleanRate}% clean</span>
      </div>
      <dl className="failure-summary">
        <div>
          <dt>failed</dt>
          <dd>{summary.failed}/{summary.total}</dd>
        </div>
        <div>
          <dt>timeout</dt>
          <dd>{summary.timeout}</dd>
        </div>
        <div>
          <dt>memory</dt>
          <dd>{summary.oom}</dd>
        </div>
        <div>
          <dt>GPU suspect</dt>
          <dd>{summary.gpuSuspect}</dd>
        </div>
      </dl>
      {diagnostics.length ? (
        <div className="failure-list">
          {diagnostics.map((item) => (
            <article key={item.jobId} className={`failure-item severity-${item.severity}`}>
              <div className="failure-title">
                <ClipboardList size={16} aria-hidden="true" />
                <strong>{item.title}</strong>
                <span className="mono">{item.jobId}</span>
              </div>
              <dl>
                <div>
                  <dt>state</dt>
                  <dd>{item.state}</dd>
                </div>
                <div>
                  <dt>exit</dt>
                  <dd>{item.exitCode}</dd>
                </div>
                <div>
                  <dt>request</dt>
                  <dd>{item.request}</dd>
                </div>
              </dl>
              <p>{item.explanation}</p>
              <span>{item.nextAction}</span>
              <div className="failure-actions">
                {failureCommands(alias, item).map((command) => (
                  <button
                    type="button"
                    key={`${item.jobId}-${command.label}`}
                    className="failure-command"
                    onClick={() => onCopy(command.command, `${item.jobId} ${command.label}`)}
                    title={command.detail}
                  >
                    <Copy size={14} aria-hidden="true" />
                    <span>{command.label}</span>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No failed jobs found in this accounting window." />
      )}
    </div>
  );
}
