import { Copy, GitFork } from "lucide-react";
import { buildDependencyAudit } from "../lib/dependencyAudit";
import type { HistoryResponse, QueueJob } from "../types";
import { SectionTitle } from "./common";

export function DependencyChainAuditor({
  jobs,
  history,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const audit = buildDependencyAudit(jobs, history?.jobs ?? [], alias);
  return (
    <div className="dependency-audit">
      <div className="dependency-audit-head">
        <SectionTitle icon={<GitFork size={18} />} title="Dependency Chain Auditor" />
        <span>{audit.label}</span>
      </div>
      <p>{audit.headline}</p>
      {audit.items.length ? (
        <div className="dependency-audit-list">
          {audit.items.slice(0, 4).map((item) => (
            <article className={`dependency-audit-row tone-${item.tone}`} key={item.jobId}>
              <div className="dependency-audit-title">
                <div>
                  <strong>{item.jobName}</strong>
                  <span className="mono">{item.jobId} / {item.user}</span>
                </div>
                <em>{item.label}</em>
              </div>
              <dl>
                <div>
                  <dt>dependency</dt>
                  <dd>{item.dependency}</dd>
                </div>
                <div>
                  <dt>upstream</dt>
                  <dd>{item.blockers.join(", ") || "n/a"}</dd>
                </div>
              </dl>
              <p>{item.evidence}</p>
              <div className="dependency-audit-action">
                <span>{item.action}</span>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => onCopy(item.command, `${item.jobId} dependency audit`)}
                  title={`Copy dependency audit for ${item.jobId}`}
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
