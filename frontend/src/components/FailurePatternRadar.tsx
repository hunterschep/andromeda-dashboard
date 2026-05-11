import { Copy, Radar } from "lucide-react";
import { buildFailurePatterns } from "../lib/failurePatterns";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function FailurePatternRadar({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const summary = buildFailurePatterns(history?.jobs ?? [], alias);
  return (
    <div className="failure-pattern-panel">
      <div className="failure-pattern-head">
        <SectionTitle icon={<Radar size={18} />} title="Failure Pattern Radar" />
        <span>{summary.label}</span>
      </div>
      {summary.patterns.length ? (
        <div className="failure-pattern-list">
          {summary.patterns.slice(0, 5).map((pattern) => (
            <article className={`failure-pattern-row tone-${pattern.tone}`} key={pattern.kind}>
              <div className="failure-pattern-title">
                <div>
                  <strong>{pattern.title}</strong>
                  <span>{pattern.jobs} job / {pattern.gpuJobs} GPU</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(pattern.command, `${pattern.kind} failure pattern`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>partitions</dt>
                  <dd>{pattern.partitions.slice(0, 3).join(", ")}</dd>
                </div>
                <div>
                  <dt>examples</dt>
                  <dd>{pattern.examples.join(", ")}</dd>
                </div>
              </dl>
              <p>{pattern.message}</p>
              <span>{pattern.action}</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No recurring failure patterns in this accounting window." />
      )}
    </div>
  );
}
