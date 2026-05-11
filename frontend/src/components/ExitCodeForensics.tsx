import { Copy, ScanSearch } from "lucide-react";
import { buildExitCodeForensics } from "../lib/exitCodeForensics";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ExitCodeForensics({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const forensics = buildExitCodeForensics(history?.jobs ?? [], alias);
  return (
    <div className="exit-forensics-panel">
      <div className="exit-forensics-head">
        <SectionTitle icon={<ScanSearch size={18} />} title="Exit Code Forensics" />
        <span>{forensics.label}</span>
      </div>
      <p>{forensics.headline}</p>
      {forensics.rows.length ? (
        <div className="exit-forensics-list">
          {forensics.rows.map((row) => (
            <article className={`exit-forensics-row tone-${row.tone}`} key={row.jobId}>
              <div className="exit-forensics-title">
                <div>
                  <strong>{row.title}</strong>
                  <span className="mono">{row.jobId} / {row.name}</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(row.command, `${row.jobId} exit forensics`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>state</dt>
                  <dd>{row.state}</dd>
                </div>
                <div>
                  <dt>exit</dt>
                  <dd>{row.exitCode}</dd>
                </div>
              </dl>
              <p>{row.detail}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No failed accounting rows need exit-code translation." />
      )}
    </div>
  );
}
